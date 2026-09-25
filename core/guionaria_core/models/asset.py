from sqlmodel import Field, SQLModel

from ._base import now_iso


class Asset(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    kind: str  # image | video | audio
    file_path: str
    thumb_path: str | None = None
    provider: str  # pexels|pixabay|unsplash|openverse|wikimedia|searxng|ytdlp|manual|tts
    provider_id: str | None = None
    source_page_url: str | None = None
    source_file_url: str | None = None
    author: str | None = None
    license: str | None = None
    width: int | None = None
    height: int | None = None
    duration_s: float | None = None
    orientation: str | None = None  # landscape | portrait | square
    size_bytes: int | None = None
    phash: str | None = None
    low_res: int = 0
    sha256: str | None = Field(default=None, index=True)  # deduplicado exacto
    reused_from_id: int | None = None  # medio de otro proyecto reutilizado aquí
    created_at: str = Field(default_factory=now_iso)
