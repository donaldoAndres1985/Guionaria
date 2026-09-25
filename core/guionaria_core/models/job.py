from sqlmodel import Field, SQLModel

from ._base import now_iso


class Job(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    # generate_script|generate_scenes|search|download|tts|transcribe|export|render|publish
    type: str
    project_id: int | None = None
    payload: str | None = None
    status: str | None = None
    progress: float | None = None
    error: str | None = None
    created_at: str = Field(default_factory=now_iso)
    finished_at: str | None = None
