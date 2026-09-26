"""Almacenamiento (sección 5.11): espacio por canal → proyecto → tipo, y limpieza de los
candidatos descargados que no se usaron.

Los archivos compartidos con enlaces duros (deduplicado, aprobados, reutilizados) se cuentan una
sola vez: el espacio que se muestra es el que ocupan de verdad en el disco.
"""

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import BaseModel
from sqlmodel import Session, col, select

from ..config import get_paths
from ..domain.states import ORDER, ProjectStatus
from ..models import Asset, Channel, Project, Scene, SceneAsset, SceneCandidate
from ..models._base import now_iso
from .errors import NotFound
from .oplog import log_operation
from .projects import project_dir

# Orden en que se atribuye un archivo compartido: primero donde está el original.
PROJECT_PARTS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("candidates", "Candidatos", ("media/candidates",)),
    ("manual", "Agregados a mano", ("media/manual",)),
    ("approved", "Aprobados", ("media/approved",)),
    ("audio", "Voz", ("audio",)),
    ("timeline", "Timeline y subtítulos", ("timeline", "subs")),
    ("render", "Render", ("render",)),
)


class StorageNode(BaseModel):
    id: str
    name: str
    kind: str  # root | channel | project | part | area
    bytes: int
    files: int
    project_id: int | None = None
    channel_id: int | None = None
    children: list["StorageNode"] = []


class StorageUsage(BaseModel):
    home: str
    tree: StorageNode
    shared_bytes: int  # lo que ocuparían de más los enlaces duros si fueran copias
    disk_total: int
    disk_free: int


@dataclass
class _Walker:
    seen: set[tuple[int, int]] = field(default_factory=set)
    shared: int = 0

    def size(self, folder: Path, skip: tuple[Path, ...] = ()) -> tuple[int, int]:
        """(bytes, archivos) de una carpeta, contando cada archivo físico una sola vez."""
        total = files = 0
        if not folder.exists():
            return 0, 0
        if folder.is_file():
            return self._file(folder)
        for root, dirs, names in os.walk(folder):
            root_path = Path(root)
            dirs[:] = [d for d in dirs if root_path / d not in skip]
            for name in names:
                b, f = self._file(root_path / name)
                total += b
                files += f
        return total, files

    def _file(self, path: Path) -> tuple[int, int]:
        try:
            st = path.stat()
        except OSError:
            return 0, 0
        key = (st.st_dev, st.st_ino)
        if st.st_nlink > 1 and st.st_ino:
            if key in self.seen:
                self.shared += st.st_size
                return 0, 1
            self.seen.add(key)
        return st.st_size, 1


def _node(id_: str, name: str, kind: str, children: list[StorageNode], **extra) -> StorageNode:
    return StorageNode(
        id=id_,
        name=name,
        kind=kind,
        bytes=sum(c.bytes for c in children),
        files=sum(c.files for c in children),
        children=sorted(children, key=lambda c: -c.bytes),
        **extra,
    )


def _leaf(walker: _Walker, id_: str, name: str, paths: list[Path], skip=()) -> StorageNode:
    total = files = 0
    for p in paths:
        b, f = walker.size(p, skip)
        total += b
        files += f
    return StorageNode(id=id_, name=name, kind="part", bytes=total, files=files)


def storage_usage(session: Session) -> StorageUsage:
    paths = get_paths()
    home = paths.home
    walker = _Walker()
    projects = session.exec(select(Project).where(col(Project.deleted_at).is_(None))).all()
    channels = {c.id: c for c in session.exec(select(Channel)).all()}

    channel_nodes: list[StorageNode] = []
    for channel in channels.values():
        project_nodes = []
        for project in (p for p in projects if p.channel_id == channel.id):
            folder = project_dir(project)
            parts = [
                _leaf(walker, f"p{project.id}:{key}", label, [folder / sub for sub in subs])
                for key, label, subs in PROJECT_PARTS
            ]
            known = tuple(folder / sub for _k, _l, subs in PROJECT_PARTS for sub in subs)
            parts.append(
                _leaf(walker, f"p{project.id}:other", "Guion, escenas y otros", [folder], known)
            )
            project_nodes.append(
                _node(
                    f"p{project.id}",
                    project.title,
                    "project",
                    [p for p in parts if p.files],
                    project_id=project.id,
                    channel_id=channel.id,
                )
            )
        brand = _leaf(
            walker, f"c{channel.id}:brand", "Marca", [paths.channels_dir / channel.slug / "brand"]
        )
        children = project_nodes + ([brand] if brand.files else [])
        channel_nodes.append(
            _node(f"c{channel.id}", channel.name, "channel", children, channel_id=channel.id)
        )

    areas = [
        _leaf(walker, "models", "Modelos de voz y Whisper", [home / "models"]),
        _leaf(walker, "trash", "Papelera", [home / "trash"]),
        _leaf(walker, "library", "Biblioteca (SFX y música)", [home / "library"]),
        _leaf(
            walker,
            "data",
            "Base de datos y ajustes",
            [paths.db, home / "guionaria.db-wal", home / "guionaria.db-shm", paths.config_dir],
        ),
    ]
    for a in areas:
        a.kind = "area"
    tree = _node("root", "Guionaria", "root", channel_nodes + [a for a in areas if a.files])
    disk = shutil.disk_usage(home)
    return StorageUsage(
        home=str(home),
        tree=tree,
        shared_bytes=walker.shared,
        disk_total=disk.total,
        disk_free=disk.free,
    )


# --- limpieza de candidatos sin usar ---


class CleanupProject(BaseModel):
    project_id: int
    title: str
    channel_name: str
    status: ProjectStatus
    media_approved: bool  # los medios ya están cerrados: lo que sobra se puede borrar tranquilo
    count: int
    bytes: int  # espacio que se libera de verdad (sin contar archivos compartidos)


class CleanupPreview(BaseModel):
    projects: list[CleanupProject]
    total_count: int
    total_bytes: int


class CleanupResult(BaseModel):
    deleted: int
    freed_bytes: int


def _unused_assets(session: Session, project_id: int) -> list[Asset]:
    scene_ids = [s.id for s in session.exec(select(Scene).where(Scene.project_id == project_id))]
    if not scene_ids:
        return []
    approved = {
        r.asset_id
        for r in session.exec(select(SceneAsset).where(col(SceneAsset.scene_id).in_(scene_ids)))
    }
    candidates = session.exec(
        select(SceneCandidate).where(
            col(SceneCandidate.scene_id).in_(scene_ids), col(SceneCandidate.asset_id).is_not(None)
        )
    ).all()
    out = []
    for c in candidates:
        if c.asset_id in approved:
            continue
        asset = session.get(Asset, c.asset_id)
        if asset:
            out.append(asset)
    return out


def _freeable(path: Path) -> int:
    """Bytes que se liberan al borrar: nada si otro enlace duro sigue apuntando al archivo."""
    try:
        st = path.stat()
    except OSError:
        return 0
    return st.st_size if st.st_nlink <= 1 else 0


def cleanup_preview(session: Session) -> CleanupPreview:
    home = get_paths().home
    channels = {c.id: c for c in session.exec(select(Channel)).all()}
    out = []
    for project in session.exec(select(Project).where(col(Project.deleted_at).is_(None))).all():
        assets = _unused_assets(session, project.id)
        if not assets:
            continue
        freed = 0
        for a in assets:
            freed += _freeable(home / a.file_path)
            if a.thumb_path:
                freed += _freeable(home / a.thumb_path)
        out.append(
            CleanupProject(
                project_id=project.id,
                title=project.title,
                channel_name=channels[project.channel_id].name,
                status=project.status,
                media_approved=ORDER.index(project.status)
                >= ORDER.index(ProjectStatus.MEDIOS_APROBADOS),
                count=len(assets),
                bytes=freed,
            )
        )
    out.sort(key=lambda p: -p.bytes)
    return CleanupPreview(
        projects=out,
        total_count=sum(p.count for p in out),
        total_bytes=sum(p.bytes for p in out),
    )


def cleanup_candidates(session: Session, project_ids: list[int]) -> CleanupResult:
    """Borra los archivos de los candidatos descargados que no se aprobaron. El candidato queda
    registrado (sin archivo) para poder volver a descargarlo desde la búsqueda."""
    home = get_paths().home
    deleted = freed = 0
    for project_id in project_ids:
        if not session.get(Project, project_id):
            raise NotFound(f"El proyecto {project_id} no existe")
        assets = _unused_assets(session, project_id)
        for asset in assets:
            for rel in (asset.file_path, asset.thumb_path):
                if rel:
                    path = home / rel
                    freed += _freeable(path)
                    path.unlink(missing_ok=True)
            for c in session.exec(
                select(SceneCandidate).where(SceneCandidate.asset_id == asset.id)
            ):
                c.asset_id = None
                c.download_status = "none"
                c.selected = 0
            session.delete(asset)
            deleted += 1
        if assets:
            project = session.get(Project, project_id)
            project.updated_at = now_iso()
            log_operation(session, "cleanup", "project", project_id, {"deleted": len(assets)})
    session.commit()
    return CleanupResult(deleted=deleted, freed_bytes=freed)
