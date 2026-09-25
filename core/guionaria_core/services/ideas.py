"""Banco de ideas por canal (sección 5.13): prioridad, notas y conversión a proyecto."""

from typing import Literal

from pydantic import BaseModel, Field
from sqlmodel import Session, col, delete, select

from ..models import Idea
from ..models._base import now_iso
from ..schemas.project import ProjectCreate, ProjectFormat, ProjectRead
from .channels import get_channel
from .errors import Conflict, NotFound
from .oplog import log_operation
from .projects import create_project

IdeaStatus = Literal["open", "converted", "discarded"]


class IdeaCreate(BaseModel):
    channel_id: int
    title: str = Field(min_length=1, max_length=160)
    notes: str | None = None
    priority: int = Field(default=2, ge=1, le=3)


class IdeaUpdate(BaseModel):
    channel_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    notes: str | None = None
    priority: int | None = Field(default=None, ge=1, le=3)
    status: Literal["open", "discarded"] | None = None  # "converted" solo al convertir


class IdeaRead(BaseModel):
    id: int
    channel_id: int
    channel_name: str
    title: str
    notes: str | None
    priority: int
    status: IdeaStatus
    project_id: int | None
    created_at: str
    updated_at: str


class ConvertRequest(BaseModel):
    format: ProjectFormat
    target_duration_s: int | None = Field(default=None, ge=5, le=4 * 3600)
    target_publish_at: str | None = None


def _read(session: Session, idea: Idea) -> IdeaRead:
    channel = get_channel(session, idea.channel_id)
    return IdeaRead(
        id=idea.id,
        channel_id=idea.channel_id,
        channel_name=channel.name,
        title=idea.title or "",
        notes=idea.notes,
        priority=idea.priority or 2,
        status=idea.status or "open",
        project_id=idea.project_id,
        created_at=idea.created_at,
        updated_at=idea.updated_at or idea.created_at,
    )


def get_idea(session: Session, idea_id: int) -> Idea:
    idea = session.get(Idea, idea_id)
    if not idea:
        raise NotFound("La idea no existe")
    return idea


def list_ideas(
    session: Session,
    channel_id: int | None = None,
    status: IdeaStatus | None = None,
    q: str | None = None,
) -> list[IdeaRead]:
    stmt = select(Idea)
    if channel_id is not None:
        stmt = stmt.where(Idea.channel_id == channel_id)
    if status is not None:
        stmt = stmt.where(Idea.status == status)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(col(Idea.title).ilike(like) | col(Idea.notes).ilike(like))
    # Prioridad alta primero; dentro de la misma prioridad, la más reciente arriba.
    ideas = session.exec(stmt.order_by(col(Idea.priority), col(Idea.id).desc())).all()
    return [_read(session, i) for i in ideas]


def create_idea(session: Session, data: IdeaCreate) -> IdeaRead:
    get_channel(session, data.channel_id)
    idea = Idea(
        channel_id=data.channel_id,
        title=data.title.strip(),
        notes=(data.notes or "").strip() or None,
        priority=data.priority,
        status="open",
        updated_at=now_iso(),
    )
    session.add(idea)
    session.flush()
    log_operation(session, "create", "idea", idea.id, {"title": idea.title})
    session.commit()
    return _read(session, idea)


def update_idea(session: Session, idea_id: int, data: IdeaUpdate) -> IdeaRead:
    idea = get_idea(session, idea_id)
    changes = data.model_dump(exclude_unset=True)
    if idea.status == "converted" and changes.keys() & {"channel_id", "status"}:
        raise Conflict("La idea ya es un proyecto: edítalo desde Proyectos")
    if "channel_id" in changes:
        get_channel(session, changes["channel_id"])
    for key, value in changes.items():
        if key == "title":
            value = value.strip()
        if key == "notes":
            value = (value or "").strip() or None
        setattr(idea, key, value)
    idea.updated_at = now_iso()
    session.commit()
    return _read(session, idea)


def delete_idea(session: Session, idea_id: int) -> None:
    idea = get_idea(session, idea_id)
    log_operation(session, "delete", "idea", idea.id, {"title": idea.title})
    session.delete(idea)
    session.commit()


def convert_idea(session: Session, idea_id: int, data: ConvertRequest) -> ProjectRead:
    """Crea el proyecto con el título y las notas de la idea y la deja enlazada."""
    idea = get_idea(session, idea_id)
    if idea.status == "converted" and idea.project_id:
        raise Conflict("La idea ya se convirtió en proyecto")
    project = create_project(
        session,
        ProjectCreate(
            channel_id=idea.channel_id,
            title=idea.title or "Sin título",
            format=data.format,
            topic=idea.title,
            research_notes=idea.notes,
            target_duration_s=data.target_duration_s,
            target_publish_at=data.target_publish_at,
            priority=idea.priority or 2,
        ),
    )
    idea = get_idea(session, idea_id)  # create_project hace commit
    idea.status = "converted"
    idea.project_id = project.id
    idea.updated_at = now_iso()
    log_operation(session, "convert", "idea", idea.id, {"project": project.id})
    session.commit()
    return project


def release_project(session: Session, project_id: int) -> None:
    """Al borrar un proyecto, su idea vuelve a estar abierta."""
    for idea in session.exec(select(Idea).where(Idea.project_id == project_id)).all():
        idea.project_id = None
        idea.status = "open"
        idea.updated_at = now_iso()


def delete_channel_ideas(session: Session, channel_id: int) -> None:
    session.exec(delete(Idea).where(col(Idea.channel_id) == channel_id))
