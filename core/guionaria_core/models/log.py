from sqlmodel import Field, SQLModel

from ._base import now_iso


class OperationLog(SQLModel, table=True):
    __tablename__ = "operation_log"

    id: int | None = Field(default=None, primary_key=True)
    at: str = Field(default_factory=now_iso)
    actor: str | None = None  # ui | mcp | system
    action: str | None = None
    entity: str | None = None
    entity_id: int | None = None
    details: str | None = None
