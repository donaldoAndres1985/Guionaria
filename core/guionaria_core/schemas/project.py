from typing import Literal

from pydantic import BaseModel, Field

from ..domain.states import ProjectStatus

ProjectFormat = Literal["video", "reel"]

# Duración objetivo por defecto (sección 6: video 8–20 min, reel 15–90 s).
DEFAULT_DURATION_S: dict[str, int] = {"video": 600, "reel": 60}


class ProjectCreate(BaseModel):
    channel_id: int
    title: str = Field(min_length=1, max_length=160)
    format: ProjectFormat
    topic: str | None = None
    research_notes: str | None = None
    target_duration_s: int | None = Field(default=None, ge=5, le=4 * 3600)
    target_publish_at: str | None = None  # fecha ISO (YYYY-MM-DD)
    priority: int = Field(default=2, ge=1, le=3)
    tags: list[str] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    topic: str | None = None
    research_notes: str | None = None
    target_duration_s: int | None = Field(default=None, ge=5, le=4 * 3600)
    target_publish_at: str | None = None
    priority: int | None = Field(default=None, ge=1, le=3)
    tags: list[str] | None = None


class ProjectRead(BaseModel):
    id: int
    channel_id: int
    channel_name: str
    channel_slug: str
    title: str
    slug: str
    format: ProjectFormat
    status: ProjectStatus
    topic: str | None
    research_notes: str | None
    target_duration_s: int | None
    target_publish_at: str | None
    priority: int
    tags: list[str]
    folder_path: str
    parent_project_id: int | None
    created_at: str
    updated_at: str
