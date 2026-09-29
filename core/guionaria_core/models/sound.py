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
    # Texto de atribución que pide la licencia (p. ej. Kevin MacLeod, CC BY 4.0): va en los
    # créditos de la descripción cuando se usa el sonido.
    attribution: str | None = None
    # Canales que lo tienen como favorito (JSON: [1, 3]): aparecen primero al elegir. La
    # biblioteca es la misma para todos los canales.
    favorite_channels: str | None = None
    duration_s: float | None = None
    tags: str | None = None  # JSON: ["whoosh", "impact"]
    mood: str | None = None  # música: tensión, misterio, triste, épica…
    bpm: int | None = None
    size_bytes: int | None = None
    sha256: str | None = None
    created_at: str = Field(default_factory=now_iso)
