from pydantic import BaseModel, Field

# --- Lo que se le pide a Claude (sección 11.1). Los seg_key los asigna la app. ---


class GuionSegmento(BaseModel):
    seccion: str = Field(description="Sección de la estructura, en minúsculas")
    texto: str = Field(min_length=1, description="Una o dos frases")
    verificar_dato: bool = Field(default=False, description="true si el dato no está en las notas")


class GuionClaude(BaseModel):
    titulo_tentativo: str
    segmentos: list[GuionSegmento] = Field(min_length=1)
    fuentes_sugeridas: list[str] = Field(default_factory=list)


class ReescrituraClaude(BaseModel):
    texto: str = Field(min_length=1, description="Solo el fragmento reescrito")
    verificar_dato: bool = False


# --- API ---


class SegmentIn(BaseModel):
    seg_key: str | None = None  # None = segmento nuevo (la app le asigna clave)
    section: str | None = None
    text: str = Field(min_length=1)
    needs_fact_check: bool = False


class ScriptSave(BaseModel):
    segments: list[SegmentIn] = Field(min_length=1)


class SegmentRead(BaseModel):
    seg_key: str
    position: int
    section: str | None
    text: str
    est_duration_s: float
    needs_fact_check: bool


class ScriptRead(BaseModel):
    project_id: int
    version: int
    status: str  # draft | approved | superseded
    source: str | None
    created_at: str
    segments: list[SegmentRead]
    word_count: int
    total_est_s: float
    target_duration_s: int | None
    words_per_second: float
    sections: list[str]


class VersionSummary(BaseModel):
    version: int
    status: str
    source: str | None
    created_at: str
    segment_count: int
    word_count: int
    total_est_s: float


class RewriteRequest(BaseModel):
    instruccion: str = Field(min_length=1, max_length=500)
    fragmento: str | None = None  # None = el segmento entero


class RewriteResult(BaseModel):
    seg_key: str
    fragmento: str
    texto: str
    verificar_dato: bool


class UnlockResult(BaseModel):
    scenes_to_review: int
