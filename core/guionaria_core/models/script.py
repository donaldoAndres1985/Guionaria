from sqlmodel import Field, SQLModel

from ._base import now_iso


class ScriptVersion(SQLModel, table=True):
    __tablename__ = "script_version"

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id")
    version: int
    status: str  # draft | approved | superseded
    source: str | None = None  # claude | manual
    created_at: str = Field(default_factory=now_iso)


class Segment(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    script_version_id: int = Field(foreign_key="script_version.id")
    seg_key: str  # estable entre versiones: seg_001
    position: int
    section: str | None = None  # gancho, contexto, desarrollo...
    text: str
    text_hash: str  # detectar cambios para propagación
    est_duration_s: float | None = None
    needs_fact_check: int = 0
