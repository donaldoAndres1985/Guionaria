from sqlmodel import Field, SQLModel

from ._base import now_iso


class Sound(SQLModel, table=True):
    """Efecto de sonido o tema musical de la biblioteca (sección 5.12)."""

    id: int | None = Field(default=None, primary_key=True)
    kind: str = Field(index=True)  # sfx | music
    title: str
    file_path: str  # relativa a GUIONARIA_HOME (library/sfx o library/music)
    provider: str  # freesound | manual
    provider_id: str | None = None
    source_url: str | None = None
    author: str | None = None
    license: str | None = None
    duration_s: float | None = None
    tags: str | None = None  # JSON: ["whoosh", "impact"]
    mood: str | None = None  # música: tensión, misterio, triste, épica…
    bpm: int | None = None
    size_bytes: int | None = None
    sha256: str | None = None
    created_at: str = Field(default_factory=now_iso)
