from typing import Literal

from pydantic import BaseModel, Field

DownloadStatus = Literal["none", "queued", "downloading", "done", "failed", "manual"]


class AssetRead(BaseModel):
    id: int
    kind: Literal["image", "video", "audio"]
    file_name: str
    file_url: str
    thumb_url: str | None
    provider: str
    provider_id: str | None
    source_page_url: str | None
    author: str | None
    license: str | None
    width: int | None
    height: int | None
    duration_s: float | None
    orientation: str | None
    size_bytes: int | None
    low_res: bool


class CandidateRead(BaseModel):
    id: int
    scene_id: int
    provider: str
    provider_id: str | None
    kind: Literal["image", "video"]
    preview_url: str | None
    video_preview_url: str | None
    full_url: str | None
    page_url: str | None
    width: int | None
    height: int | None
    duration_s: float | None
    author: str | None
    license: str | None
    query: str | None
    selected: bool
    download_status: DownloadStatus
    error: str | None
    asset: AssetRead | None


class ApprovedRead(BaseModel):
    asset: AssetRead
    role: Literal["main", "alt"]
    file_name: str
    framing_mode: Literal["none", "crop", "blur"] = "none"
    framing_pending: bool = False  # el video encuadrado se está generando
    trim_in_s: float | None = None
    trim_out_s: float | None = None
    approved_url: str | None = None


class SceneMediaRead(BaseModel):
    scene_id: int
    position: int
    seg_key: str
    media_kind: str
    narration: str | None
    visual_description: str | None
    query_en: str | None
    query_alt: str | None
    query_real: str | None
    start_s: float | None
    end_s: float | None
    status: str
    needs_media: bool
    default_query: str | None
    search_kind: Literal["image", "video"] | None
    available_providers: list[str]  # fuentes utilizables para este tipo de escena
    default_providers: list[str]  # las que se usan si no eliges (sección 5.5)
    approved: list[ApprovedRead]
    candidates: list[CandidateRead]


class SceneMediaSummary(BaseModel):
    scene_id: int
    position: int
    media_kind: str
    visual_description: str | None
    status: str
    needs_media: bool
    candidate_count: int
    downloaded_count: int
    approved_thumb_url: str | None


class MediaOverview(BaseModel):
    project_id: int
    orientation: Literal["landscape", "portrait"]
    editable: bool
    approved: bool
    configured_providers: list[str]
    scenes: list[SceneMediaSummary]
    needing_media: int
    with_media: int


class SearchRequest(BaseModel):
    query: str | None = None
    providers: (
        list[Literal["pexels", "pixabay", "unsplash", "openverse", "wikimedia", "searxng"]] | None
    ) = None
    page: int = Field(default=1, ge=1, le=20)
    any_orientation: bool = False


class SearchResult(BaseModel):
    scene: SceneMediaRead
    warnings: list[str]
    page: int
    has_more: bool


class DownloadRequest(BaseModel):
    candidate_ids: list[int] = Field(min_length=1, max_length=30)


class ApproveRequest(BaseModel):
    role: Literal["main", "alt"] = "main"


class SuggestResult(BaseModel):
    queries: list[str]
