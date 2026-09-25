from typing import Literal

from pydantic import BaseModel, Field

Platform = Literal["youtube", "tiktok", "instagram", "facebook"]


class ChannelBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    platforms: list[Platform] = Field(default_factory=list)
    language: str = "es"
    niche: str | None = None
    style_prompt: str | None = None
    script_template: str | None = None
    words_per_second: float = Field(default=2.5, ge=1, le=5)
    default_voice: str | None = None


class ChannelCreate(ChannelBase):
    pass


class ChannelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    platforms: list[Platform] | None = None
    language: str | None = None
    niche: str | None = None
    style_prompt: str | None = None
    script_template: str | None = None
    words_per_second: float | None = Field(default=None, ge=1, le=5)
    default_voice: str | None = None


class ChannelRead(ChannelBase):
    id: int
    slug: str
    project_count: int
    created_at: str
    updated_at: str
