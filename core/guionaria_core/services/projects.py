import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, select

from ..config import get_paths
from ..domain.states import ProjectStatus
from ..models import Channel, Project
from ..models._base import now_iso
from ..schemas.project import DEFAULT_DURATION_S, ProjectCreate, ProjectRead, ProjectUpdate
from ..util.slug import slugify
from .channels import get_channel
from .errors import NotFound
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


def to_read(project: Project, channel: Channel) -> ProjectRead:
    return ProjectRead(
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
    project = session.get(Project, project_id)
    if not project:
        raise NotFound("El proyecto no existe")
    return project


def read_project(session: Session, project_id: int) -> ProjectRead:
    project = get_project(session, project_id)
    return to_read(project, get_channel(session, project.channel_id))


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
    stmt = select(Project, Channel).join(Channel, Channel.id == Project.channel_id)
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
    return [to_read(p, c) for p, c in rows]


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
    """Mueve la carpeta a trash/ (la papelera con restauración llega en la Fase 3)."""
    project = get_project(session, project_id)
    folder = project_dir(project)
    if folder.exists():
        trash = get_paths().home / "trash"
        trash.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.move(str(folder), str(trash / f"{stamp}_{folder.name}"))

    # imports locales: script y scenes dependen de este módulo
    from .scenes import delete_scene_data
    from .script import delete_script_data

    delete_scene_data(session, project.id)
    delete_script_data(session, project.id)
    session.exec(text("DELETE FROM project_fts WHERE rowid = :id").bindparams(id=project.id))
    log_operation(session, "delete", "project", project.id, {"title": project.title})
    session.delete(project)
    session.commit()
