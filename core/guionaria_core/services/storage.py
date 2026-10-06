"""Almacenamiento (sección 5.11): espacio por canal → proyecto → tipo, y limpieza de los
candidatos descargados que no se usaron.

Los archivos compartidos con enlaces duros (deduplicado, aprobados, reutilizados) se cuentan una
sola vez: el espacio que se muestra es el que ocupan de verdad en el disco.
"""

import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import BaseModel
from sqlmodel import Session, col, select

from ..config import get_paths, load_settings
from ..domain.states import ORDER, ProjectStatus
from ..models import Asset, Channel, Project, Scene, SceneAsset, SceneCandidate
from ..models._base import now_iso
from .errors import DomainError, NotFound
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
                if root_path / name in skip:
                    continue
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
            # La portada no se borra al limpiar: cuenta en «otros», no en «Render».
            kept = tuple(_kept_files(folder))
            parts = [
                _leaf(walker, f"p{project.id}:{key}", label, [folder / s for s in subs], kept)
                for key, label, subs in PROJECT_PARTS
            ]
            known = tuple(folder / sub for _k, _l, subs in PROJECT_PARTS for sub in subs)
            parts.append(
                _leaf(
                    walker,
                    f"p{project.id}:other",
                    "Guion, escenas y otros",
                    [folder, *kept],
                    known,
                )
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


# --- limpieza de medios usados (videos renderizados, aprobados, voz) ---

# Partes que se pueden borrar a mano cuando el proyecto ya está terminado. "candidates" tiene su
# propio flujo (cleanup_candidates, que conserva el candidato para volver a descargarlo) y "other"
# es el guion y las escenas: no se tocan aquí.
CLEANABLE_PARTS: tuple[str, ...] = ("manual", "approved", "audio", "timeline", "render")


def cleanup_media(
    session: Session, project_ids: list[int], parts: list[str], backup: bool = False
) -> CleanupResult:
    """Borra del disco las carpetas elegidas (aprobados, agregados a mano, voz, timeline o
    render) de los proyectos indicados: para cuando el video ya está terminado y sobra el
    material usado para hacerlo. No toca la base de datos ni las filas de medios: si hace falta
    reeditar, la app avisa del archivo que falta en vez de fallar (igual que con un proyecto
    movido a mano). La portada se conserva siempre; con `backup`, antes se copian el video final
    y la portada a la carpeta de respaldo."""
    bad = [p for p in parts if p not in CLEANABLE_PARTS]
    if bad:
        raise DomainError(f"Eso no se puede borrar así: {', '.join(bad)}")
    if not parts:
        raise DomainError("Elige qué borrar")
    sub_map = {key: subs for key, _label, subs in PROJECT_PARTS}
    projects = []
    for project_id in project_ids:
        project = session.get(Project, project_id)
        if not project:
            raise NotFound(f"El proyecto {project_id} no existe")
        projects.append(project)
    if backup:
        # Primero la copia: si la carpeta de respaldo no está (unidad desconectada), no se
        # borra nada.
        backup_projects(session, project_ids)
    deleted = freed = 0
    for project in projects:
        folder = project_dir(project)
        keep = _kept_files(folder)
        touched = False
        for key in parts:
            for sub in sub_map[key]:
                target = folder / sub
                if not target.exists():
                    continue
                # De lo más hondo hacia arriba: archivos y luego las carpetas que quedan vacías.
                for path in sorted(target.rglob("*"), reverse=True):
                    if path in keep:
                        continue
                    if path.is_file():
                        freed += _freeable(path)
                        deleted += 1
                        path.unlink(missing_ok=True)
                    elif path.is_dir() and not any(path.iterdir()):
                        path.rmdir()
                if target.is_dir() and not any(target.iterdir()):
                    target.rmdir()
                touched = True
        if touched:
            project.updated_at = now_iso()
            log_operation(session, "cleanup", "project", project.id, {"parts": parts}, actor="user")
    session.commit()
    return CleanupResult(deleted=deleted, freed_bytes=freed)


def _kept_files(folder: Path) -> set[Path]:
    """Lo que la limpieza nunca borra: la portada del proyecto (la miniatura del render), que
    es la imagen que lo representa en la lista de proyectos y en el calendario."""
    from .render.service import THUMBNAIL

    return {folder / "render" / THUMBNAIL}


# --- copia de seguridad del video final y su portada ---


class BackupSuggestion(BaseModel):
    label: str  # Google Drive | OneDrive | Dropbox
    path: str


class BackupStatus(BaseModel):
    folder: str  # la configurada en Ajustes ("" si no hay)
    ok: bool  # existe (o se pudo crear) y se puede escribir
    detail: str | None = None
    free_bytes: int | None = None
    suggestions: list[BackupSuggestion] = []


class BackupItem(BaseModel):
    project_id: int
    title: str
    folder: str  # dónde quedó la copia
    files: list[str]
    copied: int  # copiados ahora (los que ya estaban iguales no se vuelven a copiar)
    bytes: int


class BackupResult(BaseModel):
    folder: str
    items: list[BackupItem]
    copied: int
    bytes: int


def _backup_root() -> Path:
    raw = load_settings().backup.folder.strip()
    if not raw:
        raise DomainError(
            "Configura la carpeta de copia de seguridad en Ajustes → Carpetas para guardar el "
            "video y la portada antes de borrarlos"
        )
    return Path(raw).expanduser()


def _check_root(root: Path) -> str | None:
    """Por qué no sirve la carpeta, o None si sirve (la crea si la carpeta de arriba existe)."""
    if not root.is_absolute():
        return "Usa una ruta completa, por ejemplo G:\\Mi unidad\\Guionaria"
    if not root.exists():
        if not root.parent.exists():
            return (
                f"No se encuentra {root.parent}: ¿está conectada la unidad o abierto Google Drive?"
            )
        try:
            root.mkdir()
        except OSError as e:
            return f"No se pudo crear la carpeta: {e.strerror or e}"
    if not root.is_dir():
        return "Esa ruta es un archivo, no una carpeta"
    probe = root / ".guionaria-prueba"
    try:
        probe.write_bytes(b"ok")
        probe.unlink()
    except OSError as e:
        return f"No se puede escribir en la carpeta: {e.strerror or e}"
    return None


def backup_suggestions() -> list[BackupSuggestion]:
    """Carpetas sincronizadas habituales en Windows: Google Drive para escritorio (la unidad
    con «Mi unidad»), OneDrive y Dropbox. Se propone una subcarpeta Guionaria dentro."""
    found: list[tuple[str, Path]] = []
    if sys.platform == "win32":
        for letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
            for name in ("Mi unidad", "My Drive"):
                base = Path(f"{letter}:/") / name
                if base.is_dir():
                    found.append(("Google Drive", base))
    user = Path.home()
    onedrive = os.environ.get("ONEDRIVE")  # en Windows no distingue mayúsculas
    for label, base in (
        ("Google Drive", user / "Google Drive"),
        ("Google Drive", user / "Mi unidad"),
        ("OneDrive", Path(onedrive) if onedrive else None),
        ("Dropbox", user / "Dropbox"),
    ):
        if base and base.is_dir():
            found.append((label, base))
    out: list[BackupSuggestion] = []
    for label, base in found:
        path = str(base / "Guionaria")
        if all(o.path != path for o in out):
            out.append(BackupSuggestion(label=label, path=path))
    return out


def backup_status(folder: str | None = None) -> BackupStatus:
    """Estado de la carpeta de respaldo: la guardada o `folder` (para probarla antes)."""
    raw = (load_settings().backup.folder if folder is None else folder).strip()
    suggestions = backup_suggestions()
    if not raw:
        return BackupStatus(folder="", ok=False, suggestions=suggestions)
    root = Path(raw).expanduser()
    problem = _check_root(root)
    return BackupStatus(
        folder=raw,
        ok=problem is None,
        detail=problem,
        free_bytes=shutil.disk_usage(root).free if problem is None else None,
        suggestions=suggestions,
    )


def _backup_files(project: Project) -> list[Path]:
    """El video final y la portada: lo necesario para volver a publicarlo."""
    from .projects import cover_path
    from .render.service import find_output

    return [p for p in (find_output(project, "final"), cover_path(project)) if p and p.exists()]


def _same_file(src: Path, dest: Path) -> bool:
    try:
        a, b = src.stat(), dest.stat()
    except OSError:
        return False
    return a.st_size == b.st_size and int(a.st_mtime) <= int(b.st_mtime)


def backup_projects(session: Session, project_ids: list[int]) -> BackupResult:
    """Copia el video final y la portada de cada proyecto a
    <carpeta de respaldo>/<canal>/<carpeta del proyecto>/. Lo que ya está igual no se vuelve a
    copiar; cada archivo se escribe con otro nombre y se renombra al terminar, para que Google
    Drive (u otro) no suba un archivo a medias."""
    root = _backup_root()
    if problem := _check_root(root):
        raise DomainError(problem)
    items = []
    for project_id in project_ids:
        project = session.get(Project, project_id)
        if not project:
            raise NotFound(f"El proyecto {project_id} no existe")
        channel = session.get(Channel, project.channel_id)
        dest_dir = root / channel.slug / project_dir(project).name
        copied = size = 0
        names = []
        for src in _backup_files(project):
            dest = dest_dir / ("portada.jpg" if src.suffix.lower() == ".jpg" else src.name)
            names.append(dest.name)
            if _same_file(src, dest):
                continue
            dest_dir.mkdir(parents=True, exist_ok=True)
            part = dest.with_name(dest.name + ".parcial")
            try:
                shutil.copy2(src, part)
                part.replace(dest)
            except OSError as e:
                part.unlink(missing_ok=True)
                raise DomainError(
                    f"No se pudo copiar {src.name} a la copia de seguridad: {e.strerror or e}"
                ) from e
            copied += 1
            size += src.stat().st_size
        if copied:
            log_operation(
                session, "backup", "project", project.id,
                {"files": names, "folder": str(dest_dir)}, actor="user",
            )  # fmt: skip
        items.append(
            BackupItem(
                project_id=project.id,
                title=project.title,
                folder=str(dest_dir),
                files=names,
                copied=copied,
                bytes=size,
            )
        )
    session.commit()
    return BackupResult(
        folder=str(root),
        items=items,
        copied=sum(i.copied for i in items),
        bytes=sum(i.bytes for i in items),
    )
