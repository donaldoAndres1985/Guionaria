"""Papelera de proyectos (sección 5.15): 30 días para restaurar.

Eliminar un proyecto no borra nada: la carpeta pasa a trash/ y el proyecto queda marcado con
`deleted_at`, oculto para el resto de la app. Restaurar devuelve la carpeta y los datos tal
cual. Vaciar (a mano o a los 30 días) borra las filas y la carpeta de verdad.
"""

import contextlib
import json
import os
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pydantic import BaseModel
from sqlmodel import Session, col, select

from ..config import get_paths
from ..models import Asset, Channel, Project, SceneAsset, VoiceTrack
from ..models._base import now_iso
from .errors import Conflict, NotFound
from .oplog import log_operation
from .projects import purge_project_data

RETENTION_DAYS = 30


class TrashItem(BaseModel):
    project_id: int
    title: str
    channel_name: str
    format: str
    status: str
    deleted_at: str
    days_left: int
    bytes: int


def _now() -> datetime:
    return datetime.now(UTC)


def _parse(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso)
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _size(folder: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(folder):
        for name in files:
            with contextlib.suppress(OSError):
                total += (Path(root) / name).stat().st_size
    return total


def trash_project(session: Session, project: Project) -> None:
    home = get_paths().home
    folder = home / project.folder_path
    if folder.exists():
        trash = home / "trash"
        trash.mkdir(exist_ok=True)
        stamp = _now().strftime("%Y%m%d-%H%M%S")
        target = trash / f"{stamp}_{folder.name}"
        shutil.move(str(folder), str(target))
        project.trash_path = target.relative_to(home).as_posix()
    project.deleted_at = now_iso()
    project.updated_at = project.deleted_at
    log_operation(session, "delete", "project", project.id, {"title": project.title})
    session.commit()


def _trashed(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if not project or not project.deleted_at:
        raise NotFound("Ese proyecto no está en la papelera")
    return project


def list_trash(session: Session) -> list[TrashItem]:
    home = get_paths().home
    channels = {c.id: c for c in session.exec(select(Channel)).all()}
    projects = session.exec(
        select(Project)
        .where(col(Project.deleted_at).is_not(None))
        .order_by(col(Project.deleted_at).desc())
    ).all()
    out = []
    for p in projects:
        left = RETENTION_DAYS - (_now() - _parse(p.deleted_at)).days
        out.append(
            TrashItem(
                project_id=p.id,
                title=p.title,
                channel_name=channels[p.channel_id].name if p.channel_id in channels else "—",
                format=p.format,
                status=p.status,
                deleted_at=p.deleted_at,
                days_left=max(left, 0),
                bytes=_size(home / p.trash_path) if p.trash_path else 0,
            )
        )
    return out


def _rewrite_paths(session: Session, old: str, new: str) -> None:
    """Si la carpeta original ya está ocupada, el proyecto vuelve con otro nombre: se
    actualizan las rutas guardadas (todas relativas a GUIONARIA_HOME)."""
    prefix = old.rstrip("/") + "/"

    def fix(value: str | None) -> str | None:
        return (
            new.rstrip("/") + "/" + value[len(prefix) :]
            if value and value.startswith(prefix)
            else value
        )

    for asset in session.exec(select(Asset).where(col(Asset.file_path).startswith(prefix))):
        asset.file_path = fix(asset.file_path)
        asset.thumb_path = fix(asset.thumb_path)
    for row in session.exec(select(SceneAsset).where(col(SceneAsset.file_path).startswith(prefix))):
        row.file_path = fix(row.file_path)
    for track in session.exec(
        select(VoiceTrack).where(col(VoiceTrack.file_path).startswith(prefix))
    ):
        track.file_path = fix(track.file_path)
        if track.transcript_json:
            data = json.loads(track.transcript_json)
            if "segment_files" in data:
                data["segment_files"] = {k: fix(v) for k, v in data["segment_files"].items()}
            track.transcript_json = json.dumps(data, ensure_ascii=False)


def restore_project(session: Session, project_id: int) -> Project:
    home = get_paths().home
    project = _trashed(session, project_id)
    source = home / project.trash_path if project.trash_path else None
    if source and source.exists():
        target = home / project.folder_path
        n = 2
        while target.exists():  # se creó otra carpeta con el mismo nombre
            target = home / f"{project.folder_path}-restaurado-{n}"
            n += 1
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))
        new_rel = target.relative_to(home).as_posix()
        if new_rel != project.folder_path:
            _rewrite_paths(session, project.folder_path, new_rel)
            project.folder_path = new_rel
    elif project.trash_path:
        raise Conflict("La carpeta del proyecto ya no está en la papelera")
    project.deleted_at = None
    project.trash_path = None
    project.updated_at = now_iso()
    log_operation(session, "restore", "project", project.id, {"title": project.title})
    session.commit()
    return project


def purge_project(session: Session, project_id: int, actor: str | None = None) -> None:
    home = get_paths().home
    project = _trashed(session, project_id)
    if project.trash_path:
        shutil.rmtree(home / project.trash_path, ignore_errors=True)
    log_operation(session, "purge", "project", project.id, {"title": project.title}, actor=actor)
    purge_project_data(session, project)
    session.commit()


def empty_trash(session: Session) -> int:
    ids = [p.id for p in session.exec(select(Project).where(col(Project.deleted_at).is_not(None)))]
    for pid in ids:
        purge_project(session, pid)
    return len(ids)


def purge_expired(session: Session) -> int:
    """Al iniciar el núcleo: borra lo que lleva más de 30 días en la papelera."""
    limit = _now() - timedelta(days=RETENTION_DAYS)
    expired = [
        p.id
        for p in session.exec(select(Project).where(col(Project.deleted_at).is_not(None)))
        if _parse(p.deleted_at) < limit
    ]
    for pid in expired:
        purge_project(session, pid, actor="system")
    return len(expired)


def purge_channel_trash(session: Session, channel_id: int) -> None:
    for p in session.exec(
        select(Project).where(
            Project.channel_id == channel_id, col(Project.deleted_at).is_not(None)
        )
    ).all():
        purge_project(session, p.id)
