from sqlmodel import Field, SQLModel

from ._base import now_iso


class Channel(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    slug: str = Field(unique=True)
    platforms: str  # JSON: ["youtube","tiktok"]
    language: str = "es"
    niche: str | None = None
    style_prompt: str | None = None  # tono/reglas para Claude
    script_template: str | None = None  # estructura del guion
    words_per_second: float = 2.5
    default_voice: str | None = None
    brand_json: str | None = None  # colores, fuentes, intro/outro
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
