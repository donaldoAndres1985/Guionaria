from sqlalchemy import CheckConstraint
from sqlmodel import Field, SQLModel

from ._base import now_iso


class Project(SQLModel, table=True):
    __table_args__ = (CheckConstraint("format IN ('video','reel')", name="ck_project_format"),)

    id: int | None = Field(default=None, primary_key=True)
    channel_id: int = Field(foreign_key="channel.id")
    title: str
    slug: str
    format: str  # video | reel
    status: str
    topic: str | None = None
    research_notes: str | None = None
    target_duration_s: int | None = None
    target_publish_at: str | None = None
    priority: int = 2
    tags: str | None = None  # JSON
    folder_path: str
    parent_project_id: int | None = Field(default=None, foreign_key="project.id")  # reels derivados
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    deleted_at: str | None = None  # en la papelera desde esta fecha (30 días para restaurar)
    trash_path: str | None = None  # carpeta dentro de trash/ (relativa a GUIONARIA_HOME)
