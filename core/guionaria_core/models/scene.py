from sqlmodel import Field, SQLModel


class Scene(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id")
    seg_key: str
    position: int
    start_s: float | None = None
    end_s: float | None = None
    timing_source: str = "estimated"  # estimated | whisper | manual
    narration: str | None = None
    media_kind: str  # video | image | real | text | black
    visual_description: str | None = None
    query_en: str | None = None
    query_alt: str | None = None
    query_real: str | None = None
    effect: str | None = None
    on_screen_text: str | None = None
    sfx: str | None = None
    music_cue: str | None = None
    status: str  # pending|candidates|approved|manual|review
    approved_asset_id: int | None = Field(default=None, foreign_key="asset.id")


class SceneCandidate(SQLModel, table=True):
    __tablename__ = "scene_candidate"

    id: int | None = Field(default=None, primary_key=True)
    scene_id: int = Field(foreign_key="scene.id")
    provider: str
    provider_id: str | None = None
    preview_url: str | None = None
    full_url: str | None = None
    page_url: str | None = None
    width: int | None = None
    height: int | None = None
    duration_s: float | None = None
    license: str | None = None
    author: str | None = None
    query: str | None = None
    selected: int = 0
    download_status: str = "none"  # none|queued|downloading|done|failed|manual
    asset_id: int | None = Field(default=None, foreign_key="asset.id")
    error: str | None = None


class SceneAsset(SQLModel, table=True):
    """Medio aprobado + alternos de una escena, con recortes."""

    __tablename__ = "scene_asset"

    scene_id: int = Field(foreign_key="scene.id", primary_key=True)
    asset_id: int = Field(foreign_key="asset.id", primary_key=True)
    role: str = "main"  # main | alt
    crop_json: str | None = None  # encuadre para 16:9 / 9:16
    trim_in_s: float | None = None
    trim_out_s: float | None = None
