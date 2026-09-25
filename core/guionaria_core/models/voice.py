from sqlmodel import Field, SQLModel

from ._base import now_iso


class VoiceTrack(SQLModel, table=True):
    __tablename__ = "voice_track"

    id: int | None = Field(default=None, primary_key=True)
    project_id: int | None = Field(default=None, foreign_key="project.id")
    source: str | None = None  # recorded | piper | kokoro
    file_path: str | None = None
    duration_s: float | None = None
    transcript_json: str | None = None  # palabras con timestamps
    created_at: str = Field(default_factory=now_iso)
