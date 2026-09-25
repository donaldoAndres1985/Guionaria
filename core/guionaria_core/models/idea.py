from sqlmodel import Field, SQLModel

from ._base import now_iso


class Idea(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    channel_id: int | None = Field(default=None, foreign_key="channel.id")
    title: str | None = None
    notes: str | None = None
    priority: int | None = None
    status: str | None = None
    created_at: str = Field(default_factory=now_iso)
