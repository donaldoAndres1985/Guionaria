from sqlmodel import Field, SQLModel

from ._base import now_iso


class Idea(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    channel_id: int | None = Field(default=None, foreign_key="channel.id")
    title: str | None = None
    notes: str | None = None
    priority: int | None = None  # 1 alta · 2 media · 3 baja
    status: str | None = None  # open | converted | discarded
    project_id: int | None = Field(default=None, foreign_key="project.id")  # si se convirtió
    created_at: str = Field(default_factory=now_iso)
    updated_at: str | None = None
