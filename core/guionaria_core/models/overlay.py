from sqlmodel import Field, SQLModel

from ._base import now_iso


class TimelineTrack(SQLModel, table=True):
    """Pista agregada a mano en el timeline (las de Guionaria —video, subtítulos, SFX y
    música por escena, voz— no se guardan aquí y no se pueden borrar)."""

    __tablename__ = "timeline_track"

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    kind: str  # text | sfx
    name: str
    position: int = 0  # orden de las pistas manuales (de arriba abajo)
    created_at: str = Field(default_factory=now_iso)


class TimelineItem(SQLModel, table=True):
    """Un elemento de una pista manual: un texto con formato o un efecto de sonido, con su
    inicio y duración en segundos del video final."""

    __tablename__ = "timeline_item"

    id: int | None = Field(default=None, primary_key=True)
    track_id: int = Field(foreign_key="timeline_track.id", index=True)
    start_s: float
    duration_s: float
    text: str | None = None  # pistas de texto
    style_json: str | None = None  # TextOverlayStyle (JSON)
    sound_id: int | None = Field(default=None, foreign_key="sound.id")  # pistas de SFX
    volume: int = 100  # % sobre el volumen normal de los SFX
    fade_in_s: float = 0.0
    fade_out_s: float = 0.0
    created_at: str = Field(default_factory=now_iso)
