from typing import Literal

from pydantic import BaseModel, Field

# Tipos en el contrato con Claude (español, sección 11.2) ↔ media_kind en la BD (sección 10).
Tipo = Literal["video", "imagen", "real", "texto", "negro"]
MediaKind = Literal["video", "image", "real", "text", "black"]
Effect = Literal[
    "zoom_lento_in",
    "zoom_lento_out",
    "ken_burns",
    "estatica",
    "fundido_negro",
    "glitch",
    "camara_rapida",
    "ninguno",
]
SceneStatus = Literal["pending", "candidates", "approved", "manual", "review"]

KIND_FROM_TIPO: dict[str, str] = {
    "video": "video",
    "imagen": "image",
    "real": "real",
    "texto": "text",
    "negro": "black",
}
TIPO_FROM_KIND = {v: k for k, v in KIND_FROM_TIPO.items()}
EFFECTS: tuple[str, ...] = Effect.__args__  # type: ignore[attr-defined]


# --- Lo que se le pide a Claude. Los tiempos los calcula la app. ---


class EscenaClaude(BaseModel):
    seg_key: str
    tipo: Tipo
    descripcion_visual: str = Field(min_length=1)
    busqueda_en: str = ""
    busqueda_alt: str = ""
    busqueda_real: str = ""
    efecto: Effect = "ninguno"
    texto_pantalla: str = ""
    sfx: str = ""
    musica: str = ""


class EscenasClaude(BaseModel):
    escenas: list[EscenaClaude] = Field(min_length=1)


# --- API ---


class SceneRead(BaseModel):
    id: int
    seg_key: str
    position: int
    start_s: float | None
    end_s: float | None
    timing_source: str
    narration: str | None
    media_kind: MediaKind
    visual_description: str | None
    query_en: str | None
    query_alt: str | None
    query_real: str | None
    effect: str | None
    on_screen_text: str | None
    sfx: str | None
    music_cue: str | None
    status: SceneStatus
    approved_asset_id: int | None
    segment_missing: bool  # su segmento ya no está en el guion


class ScenesRead(BaseModel):
    project_id: int
    editable: bool
    approved: bool
    scenes: list[SceneRead]
    total_s: float
    review_count: int
    segments_without_scenes: list[str]


class SceneUpdate(BaseModel):
    media_kind: MediaKind | None = None
    visual_description: str | None = None
    query_en: str | None = None
    query_alt: str | None = None
    query_real: str | None = None
    effect: Effect | None = None
    on_screen_text: str | None = None
    sfx: str | None = None
    music_cue: str | None = None


class GenerateScenesRequest(BaseModel):
    # all: todas las escenas de nuevo. pending: solo segmentos sin escenas o con escenas a revisar.
    mode: Literal["all", "pending"] = "all"


class ReorderRequest(BaseModel):
    scene_ids: list[int] = Field(min_length=1)


class ExportResult(BaseModel):
    format: Literal["md", "csv"]
    path: str
