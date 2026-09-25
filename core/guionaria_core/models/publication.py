from sqlmodel import Field, SQLModel


class Publication(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    project_id: int | None = Field(default=None, foreign_key="project.id")
    platform: str | None = None
    account: str | None = None
    title: str | None = None
    description: str | None = None
    tags: str | None = None
    thumbnail_path: str | None = None
    visibility: str | None = None
    scheduled_at: str | None = None
    published_at: str | None = None
    external_id: str | None = None
    external_url: str | None = None
    status: str | None = None
    error: str | None = None
