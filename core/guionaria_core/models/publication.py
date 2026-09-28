from sqlmodel import Field, SQLModel

from ._base import now_iso


class Publication(SQLModel, table=True):
    """Una publicación de un proyecto en una plataforma (youtube, tiktok, instagram, facebook)."""

    id: int | None = Field(default=None, primary_key=True)
    project_id: int | None = Field(default=None, foreign_key="project.id")
    platform: str | None = None
    account: str | None = None  # canal o cuenta de destino (p. ej. el canal de YouTube)
    title: str | None = None
    description: str | None = None
    tags: str | None = None  # JSON: etiquetas (YouTube) o hashtags
    thumbnail_path: str | None = None  # relativo a GUIONARIA_HOME
    visibility: str | None = None  # public | unlisted | private
    scheduled_at: str | None = None  # ISO con zona horaria
    published_at: str | None = None
    external_id: str | None = None
    external_url: str | None = None
    status: str | None = None  # draft | scheduled | uploading | published | failed
    error: str | None = None
    enabled: bool = True  # «publicar en…»
    # Opciones de títulos, hashtags, comentario fijado, capítulos, contenido para niños,
    # playlist, verificaciones marcadas…
    meta_json: str | None = None
    created_at: str | None = Field(default_factory=now_iso)
    updated_at: str | None = Field(default_factory=now_iso)
