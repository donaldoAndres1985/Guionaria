"""Publicación (sección 5.14): lo que Claude devuelve (en español, como el resto de prompts) y
lo que guarda y muestra la app."""

from typing import Literal

from pydantic import BaseModel, Field

Platform = Literal["youtube", "tiktok", "instagram", "facebook"]
Status = Literal["draft", "scheduled", "uploading", "published", "failed"]


class PlataformaClaude(BaseModel):
    plataforma: Platform
    titulos: list[str] = Field(min_length=1, max_length=3)
    descripcion: str
    hashtags: list[str] = Field(default_factory=list, description="Sin el símbolo #")
    etiquetas: list[str] = Field(default_factory=list, description="Solo YouTube")
    comentario_fijado: str | None = None


class CapituloClaude(BaseModel):
    tiempo: str = Field(description="m:ss")
    titulo: str


class MetadatosClaude(BaseModel):
    plataformas: list[PlataformaClaude] = Field(min_length=1)
    capitulos: list[CapituloClaude] = Field(default_factory=list)


class TituloClaude(BaseModel):
    titulo: str
    gancho: str = Field(description="Tipo de gancho de la guía (p. ej. Contradicción + Cifra)")
    por_que: str = Field(description="En una frase, por qué funciona")


class TitulosClaude(BaseModel):
    titulos: list[TituloClaude] = Field(min_length=3, max_length=10)


class DisenoClaude(BaseModel):
    cuadro: int = Field(ge=1, description="Número del archivo cuadro_NN.jpg")
    plantilla: Literal["impacto", "documental", "expediente"]
    texto: str = Field(description="2 a 4 palabras")
    resaltar: str | None = Field(default=None, description="Palabra del texto en color de acento")
    etiqueta: str | None = None
    color: str = Field(default="#FFD400", pattern=r"^#[0-9A-Fa-f]{6}$")
    foco_x: float = Field(default=0.5, ge=0, le=1)
    foco_y: float = Field(default=0.45, ge=0, le=1)
    por_que: str = ""


class MiniaturaClaude(BaseModel):
    disenos: list[DisenoClaude] = Field(min_length=1, max_length=3)


class TitleIdea(BaseModel):
    title: str
    hook: str
    why: str


class CoverOption(BaseModel):
    index: int
    url: str
    design: DisenoClaude


class PublicationMeta(BaseModel):
    """Lo que no cabe en las columnas de `publication` (va en meta_json)."""

    title_options: list[str] = Field(default_factory=list)
    title_ideas: list[TitleIdea] = Field(default_factory=list)  # «Proponer títulos con gancho»
    hashtags: list[str] = Field(default_factory=list)
    pinned_comment: str | None = None
    chapters: list[CapituloClaude] = Field(default_factory=list)
    made_for_kids: bool | None = None  # YouTube: obligatorio decidirlo
    synthetic: bool = False  # contenido alterado o sintético realista (YouTube lo pide)
    playlist_id: str | None = None
    captions: bool = True  # subir los subtítulos SRT (YouTube)
    category_id: str = "22"  # YouTube: 22 = Personas y blogs; 25 = Noticias; 27 = Educación
    thumbnail_time_s: float | None = None
    thumbnail_text: str | None = None
    checks: dict[str, bool] = Field(default_factory=dict)  # verificaciones marcadas a mano
    warning: str | None = None  # p. ej. «Google la dejó privada hasta la auditoría»


class CheckItem(BaseModel):
    id: str
    label: str
    done: bool
    manual: bool  # se marca a mano (si no, la app lo comprueba)
    hint: str | None = None


class PublicationRead(BaseModel):
    id: int
    platform: Platform
    label: str
    enabled: bool
    title: str
    description: str
    tags: list[str]
    visibility: str
    scheduled_at: str | None
    published_at: str | None
    external_url: str | None
    status: Status
    error: str | None
    meta: PublicationMeta
    checklist: list[CheckItem]
    limits: dict[str, int]
    full_text: str  # listo para copiar: descripción + hashtags (+ créditos)
    # Texto único para las plataformas sin campo de título (TikTok, Instagram): título arriba.
    caption: str
    upload_url: str  # dónde se publica a mano
    thumbnail_url: str | None


class PublishingState(BaseModel):
    project_id: int
    channel_id: int
    channel_name: str
    format: str
    can_publish: bool
    reason: str | None
    video_url: str | None
    video_file: str | None
    subtitles: bool
    credits: str
    publications: list[PublicationRead]
    cover_options: list[CoverOption] = Field(default_factory=list)  # propuestas de Claude
    youtube: "YouTubeStatus"


class YouTubeStatus(BaseModel):
    configured: bool  # hay cliente OAuth en Ajustes
    connected: bool  # este canal tiene acceso
    account: str | None  # nombre del canal de YouTube
    redirect_uri: str


class PublicationUpdate(BaseModel):
    enabled: bool | None = None
    title: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    hashtags: list[str] | None = None
    pinned_comment: str | None = None
    visibility: Literal["public", "unlisted", "private"] | None = None
    scheduled_at: str | None = None
    clear_schedule: bool = False
    made_for_kids: bool | None = None
    synthetic: bool | None = None
    playlist_id: str | None = None
    captions: bool | None = None
    category_id: str | None = None
    checks: dict[str, bool] | None = None


class MarkPublished(BaseModel):
    url: str = Field(min_length=8)


class ThumbnailRequest(BaseModel):
    time_s: float = Field(ge=0)
    text: str | None = None  # título encima; None = sin texto


class CoverChoice(BaseModel):
    index: int = Field(ge=1)


class CoverRedraw(BaseModel):
    index: int = Field(ge=1)
    design: DisenoClaude


class QueueItem(BaseModel):
    id: int
    project_id: int
    project_title: str
    channel_id: int
    channel_name: str
    platform: Platform
    label: str
    title: str
    status: Status
    scheduled_at: str | None
    published_at: str | None
    external_url: str | None
    target_publish_at: str | None


PublishingState.model_rebuild()
