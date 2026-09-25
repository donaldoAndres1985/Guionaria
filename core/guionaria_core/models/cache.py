from sqlmodel import Field, SQLModel

from ._base import now_iso


class SearchCache(SQLModel, table=True):
    __tablename__ = "search_cache"

    key: str = Field(primary_key=True)  # provider+query+orientation+page
    response: str | None = None
    created_at: str = Field(default_factory=now_iso)
