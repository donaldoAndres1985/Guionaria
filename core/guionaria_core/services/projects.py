import json
import re
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, col, select

from ..config import get_paths
from ..domain.states import ProjectStatus
from ..models import Asset, Channel, Job, Project, Publication, Scene, SceneAsset
from ..models._base import now_iso
from ..schemas.project import (
    DEFAULT_DURATION_S,
    ProjectCreate,
    ProjectRead,
    ProjectUpdate,
    PublishBadge,
)
from ..util.slug import slugify
from .channels import get_channel
from .errors import Conflict, DomainError, NotFound
from .oplog import log_operation

# Subcarpetas de cada proyecto (sección 8). render/ se crea en la fase de render.
PROJECT_SUBDIRS = (
    "media/approved",
    "media/candidates",
    "media/manual",
    "audio/segments",
    "subs",
    "timeline",
)


def project_dir(project: Project) -> Path:
    # folder_path es relativo a GUIONARIA_HOME para que la carpeta de datos sea movible.
    return get_paths().home / project.folder_path


PLATFORM_ORDER = ("youtube", "tiktok", "instagram", "facebook")


def publish_badges(session: Session, ids: list[int]) -> dict[int, list[PublishBadge]]:
    """Plataformas activas de cada proyecto con su estado y enlace."""
    if not ids:
        return {}
    rows = session.exec(
        select(Publication).where(col(Publication.project_id).in_(ids), Publication.enabled)
    ).all()
    out: dict[int, list[PublishBadge]] = {}
    for r in sorted(
        rows, key=lambda r: PLATFORM_ORDER.index(r.platform) if r.platform in PLATFORM_ORDER else 9
    ):
        out.setdefault(r.project_id, []).append(
            PublishBadge(
                id=r.id, platform=r.platform, status=r.status or "draft", url=r.external_url
            )
        )
    return out


MEDIA_THUMBS = 5


def cover_path(project: Project) -> Path | None:
    """Portada del proyecto: la miniatura elegida en Publicación o la del render."""
    folder = project_dir(project)
    for path in (folder / "publicacion" / "miniatura.jpg", folder / "render" / "miniatura.jpg"):
        if path.exists():
            return path
    return None


def media_previews(session: Session, ids: list[int]) -> dict[int, tuple[list[int], int]]:
    """Medios aprobados (principales) de cada proyecto, en el orden de las escenas:
    (hasta MEDIA_THUMBS ids de asset, total)."""
    if not ids:
        return {}
    rows = session.exec(
        select(Scene.project_id, SceneAsset.asset_id, Asset.thumb_path)
        .join(SceneAsset, SceneAsset.scene_id == Scene.id)
        .join(Asset, Asset.id == SceneAsset.asset_id)
        .where(col(Scene.project_id).in_(ids), SceneAsset.role == "main")
        .order_by(Scene.project_id, Scene.position)
    ).all()
    home = get_paths().home
    out: dict[int, tuple[list[int], int]] = {}
    for project_id, asset_id, thumb in rows:
        thumbs, count = out.get(project_id, ([], 0))
        # Solo miniaturas que siguen en disco: tras una limpieza la lista mostraba imágenes rotas.
        if len(thumbs) < MEDIA_THUMBS and thumb and (home / thumb).exists():
            thumbs.append(asset_id)
        out[project_id] = (thumbs, count + 1)
    return out


def _extras(session: Session, projects: list[Project]) -> dict[int, dict]:
    ids = [p.id for p in projects]
    badges = publish_badges(session, ids)
    media = media_previews(session, ids)
    out = {}
    for p in projects:
        cover = cover_path(p)
        thumbs, count = media.get(p.id, ([], 0))
        out[p.id] = {
            "publications": badges.get(p.id, []),
            "cover_url": (
                f"/api/projects/{p.id}/cover?v={cover.stat().st_mtime_ns}" if cover else None
            ),
            "media_thumbs": [f"/api/assets/{a}/thumb" for a in thumbs],
            "media_count": count,
        }
    return out


def to_read(
    project: Project,
    channel: Channel,
    badges: list[PublishBadge] | None = None,
    extras: dict | None = None,
) -> ProjectRead:
    from .research import read_research  # import local: research usa este módulo

    extras = extras or {}
    return ProjectRead(
        publications=extras.get("publications", badges or []),
        origin=project.origin or "guionaria",
        cover_url=extras.get("cover_url"),
        media_thumbs=extras.get("media_thumbs", []),
        media_count=extras.get("media_count", 0),
        research=read_research(project.research_json),
        id=project.id,
        channel_id=project.channel_id,
        channel_name=channel.name,
        channel_slug=channel.slug,
        title=project.title,
        slug=project.slug,
        format=project.format,
        status=project.status,
        topic=project.topic,
        research_notes=project.research_notes,
        target_duration_s=project.target_duration_s,
        target_publish_at=project.target_publish_at,
        priority=project.priority,
        tags=json.loads(project.tags or "[]"),
        folder_path=str(project_dir(project)),
        parent_project_id=project.parent_project_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def get_project(session: Session, project_id: int) -> Project:
    """Proyecto activo. Los que están en la papelera no existen para el resto de la app."""
    project = session.get(Project, project_id)
    if not project or project.deleted_at:
        raise NotFound("El proyecto no existe")
    return project


def read_project(session: Session, project_id: int) -> ProjectRead:
    project = get_project(session, project_id)
    extras = _extras(session, [project])[project.id]
    return to_read(project, get_channel(session, project.channel_id), extras=extras)


def _fts_query(q: str) -> str | None:
    # Cada palabra como prefijo entre comillas: "secu"* encuentra "secuestro".
    tokens = re.findall(r"\w+", q)
    return " ".join(f'"{t}"*' for t in tokens) or None


def list_projects(
    session: Session,
    channel_id: int | None = None,
    status: ProjectStatus | None = None,
    q: str | None = None,
) -> list[ProjectRead]:
    stmt = (
        select(Project, Channel)
        .join(Channel, Channel.id == Project.channel_id)
        .where(col(Project.deleted_at).is_(None))
    )
    if channel_id is not None:
        stmt = stmt.where(Project.channel_id == channel_id)
    if status is not None:
        stmt = stmt.where(Project.status == status)
    if q and (match := _fts_query(q)):
        ids = session.exec(
            text("SELECT rowid FROM project_fts WHERE project_fts MATCH :m").bindparams(m=match)
        ).all()
        stmt = stmt.where(Project.id.in_([row[0] for row in ids]))
    rows = session.exec(stmt.order_by(Project.updated_at.desc())).all()
    extras = _extras(session, [p for p, _c in rows])
    return [to_read(p, c, extras=extras[p.id]) for p, c in rows]


def index_fts(session: Session, project: Project, script_text: str | None = None) -> None:
    """Reindexa el proyecto. Sin script_text se conserva el texto de guion ya indexado."""
    if script_text is None:
        row = session.exec(
            text("SELECT script_text FROM project_fts WHERE rowid = :id").bindparams(id=project.id)
        ).first()
        script_text = row[0] if row else ""
    session.exec(text("DELETE FROM project_fts WHERE rowid = :id").bindparams(id=project.id))
    session.exec(
        text(
            "INSERT INTO project_fts (rowid, title, topic, script_text, tags) "
            "VALUES (:id, :title, :topic, :script, :tags)"
        ).bindparams(
            id=project.id,
            title=project.title,
            topic=project.topic or "",
            script=script_text,
            tags=" ".join(json.loads(project.tags or "[]")),
        )
    )


def _write_snapshot(project: Project, channel: Channel) -> None:
    """project.json: copia legible del proyecto dentro de su carpeta."""
    data = to_read(project, channel).model_dump(exclude={"folder_path"})
    (project_dir(project) / "project.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _unique_folder(channel: Channel, slug: str, fmt: str) -> str:
    base = f"{datetime.now().date().isoformat()}_{slug}_{fmt}"
    projects_dir = get_paths().channels_dir / channel.slug / "projects"
    name, n = base, 2
    while (projects_dir / name).exists():
        name, n = f"{base}-{n}", n + 1
    return f"channels/{channel.slug}/projects/{name}"


def create_project(session: Session, data: ProjectCreate) -> ProjectRead:
    channel = get_channel(session, data.channel_id)
    slug = slugify(data.title)
    project = Project(
        channel_id=channel.id,
        title=data.title,
        slug=slug,
        format=data.format,
        status=ProjectStatus.IDEA,
        topic=data.topic,
        research_notes=data.research_notes,
        target_duration_s=data.target_duration_s or DEFAULT_DURATION_S[data.format],
        target_publish_at=data.target_publish_at,
        priority=data.priority,
        tags=json.dumps(data.tags, ensure_ascii=False),
        folder_path=_unique_folder(channel, slug, data.format),
    )
    session.add(project)
    session.flush()

    folder = project_dir(project)
    for sub in PROJECT_SUBDIRS:
        (folder / sub).mkdir(parents=True, exist_ok=True)
    index_fts(session, project)
    _write_snapshot(project, channel)

    log_operation(
        session, "create", "project", project.id, {"title": project.title, "format": project.format}
    )
    session.commit()
    session.refresh(project)
    return to_read(project, channel)


def update_project(session: Session, project_id: int, data: ProjectUpdate) -> ProjectRead:
    project = get_project(session, project_id)
    changes = data.model_dump(exclude_unset=True)
    if "tags" in changes:
        changes["tags"] = json.dumps(changes["tags"] or [], ensure_ascii=False)
    for key, value in changes.items():
        setattr(project, key, value)
    project.updated_at = now_iso()

    channel = get_channel(session, project.channel_id)
    index_fts(session, project)
    _write_snapshot(project, channel)
    log_operation(session, "update", "project", project.id, {"fields": sorted(changes)})
    session.commit()
    return to_read(project, channel)


def delete_project(session: Session, project_id: int) -> None:
    """Mueve el proyecto a la papelera (en cualquier etapa): se puede restaurar durante 30
    días. No se borra mientras un trabajo usa su carpeta (render, voz, subida…)."""
    from .jobs import ACTIVE
    from .trash import trash_project  # import local: la papelera depende de este módulo

    project = get_project(session, project_id)
    busy = session.exec(
        select(Job).where(Job.project_id == project_id, col(Job.status).in_(ACTIVE))
    ).first()
    if busy:
        raise Conflict(
            f"Hay un trabajo en curso ({busy.type}): cancélalo o espera a que termine "
            "antes de eliminar el proyecto"
        )
    try:
        trash_project(session, project)
    except OSError as exc:
        session.rollback()
        raise DomainError(
            "No se pudo mover la carpeta a la papelera: cierra los archivos del proyecto "
            "abiertos en otro programa (video, explorador) y vuelve a intentarlo"
        ) from exc


def purge_project_data(session: Session, project: Project) -> None:
    """Borrado definitivo de las filas del proyecto (al vaciar la papelera)."""
    from .ideas import release_project
    from .media.service import delete_media_data
    from .scenes import delete_scene_data
    from .script import delete_script_data
    from .timeline.overlays import delete_project_tracks
    from .voice.service import delete_voice_data

    release_project(session, project.id)
    delete_project_tracks(session, project.id)
    delete_media_data(session, project)
    delete_scene_data(session, project.id)
    delete_script_data(session, project.id)
    delete_voice_data(session, project.id)
    session.exec(text("DELETE FROM project_fts WHERE rowid = :id").bindparams(id=project.id))
    session.delete(project)


# Etapas finales que todavía se hacen fuera de la app (render y publicación): se marcan a mano,
# por ejemplo arrastrando la tarjeta en el tablero. Las anteriores solo avanzan aprobando.
MANUAL_STATUSES = (
    ProjectStatus.TIMELINE_LISTO,
    ProjectStatus.RENDERIZADO,
    ProjectStatus.PROGRAMADO,
    ProjectStatus.PUBLICADO,
)


def set_manual_status(session: Session, project_id: int, status: ProjectStatus) -> ProjectRead:
    project = get_project(session, project_id)
    if project.status not in MANUAL_STATUSES:
        raise Conflict("El proyecto avanza aprobando cada etapa hasta tener el timeline")
    if status not in MANUAL_STATUSES:
        raise Conflict(
            "Solo se puede mover entre Timeline listo, Renderizado, Programado y Publicado"
        )
    if status != project.status:
        log_operation(
            session, "status", "project", project.id, {"from": project.status, "to": status}
        )
        project.status = status
        project.updated_at = now_iso()
        session.commit()
    return read_project(session, project_id)
