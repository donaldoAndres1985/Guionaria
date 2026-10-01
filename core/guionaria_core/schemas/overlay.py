"""Pistas manuales del timeline: textos con formato (como CapCut) y efectos de sonido."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ..config import HEX

# Fuentes del texto: Montserrat va incluida con la app; el resto son de Windows.
TextFont = Literal[
    "Montserrat",
    "Arial",
    "Impact",
    "Verdana",
    "Segoe UI",
    "Georgia",
    "Times New Roman",
    "Courier New",
    "Comic Sans MS",
    "Trebuchet MS",
    "Tahoma",
    "Bahnschrift",
]
AnimationIn = Literal[
    "none",
    "fade",
    "pop",
    "zoom",
    "slide_up",
    "slide_down",
    "slide_left",
    "slide_right",
    "blur",
    "typewriter",
]
AnimationOut = Literal[
    "none", "fade", "pop", "zoom", "slide_up", "slide_down", "slide_left", "slide_right", "blur"
]
TrackKind = Literal["text", "sfx"]


class TextOverlayStyle(BaseModel):
    """Formato de un texto de una pista manual. Tamaños y distancias en píxeles del cuadro del
    proyecto (1920×1080 o 1080×1920); posición en fracciones del cuadro."""

    font: TextFont = "Montserrat"
    size: int = Field(72, ge=12, le=400)
    color: str = Field("#FFFFFF", pattern=HEX)
    bold: bool = True
    italic: bool = False
    underline: bool = False
    uppercase: bool = False
    align: Literal["left", "center", "right"] = "center"
    letter_spacing: int = Field(0, ge=-10, le=40)
    max_width: int = Field(90, ge=20, le=100)  # % del ancho en que se parten las líneas
    x: float = Field(0.5, ge=0, le=1)  # punto de anclaje (centro, borde izquierdo o derecho)
    y: float = Field(0.5, ge=0, le=1)
    rotation: int = Field(0, ge=-180, le=180)  # grados, en el sentido del reloj
    opacity: int = Field(100, ge=0, le=100)
    outline: bool = True
    outline_color: str = Field("#000000", pattern=HEX)
    outline_width: int = Field(4, ge=0, le=30)
    shadow: bool = False
    shadow_color: str = Field("#000000", pattern=HEX)
    shadow_opacity: int = Field(60, ge=0, le=100)
    shadow_distance: int = Field(4, ge=0, le=40)
    shadow_blur: int = Field(4, ge=0, le=30)
    background: bool = False  # caja detrás del texto (reemplaza el borde y la sombra)
    background_color: str = Field("#000000", pattern=HEX)
    background_opacity: int = Field(70, ge=0, le=100)
    background_padding: int = Field(16, ge=0, le=80)
    animation_in: AnimationIn = "fade"
    animation_out: AnimationOut = "fade"
    animation_s: float = Field(0.4, ge=0.1, le=2.0)


MAX_TEXT = 600
MIN_ITEM_S = 0.2


class TrackCreate(BaseModel):
    kind: TrackKind
    name: str | None = Field(default=None, max_length=60)


class TrackUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class ItemCreate(BaseModel):
    start_s: float = Field(ge=0)
    duration_s: float = Field(ge=MIN_ITEM_S, le=3600)
    text: str | None = Field(default=None, max_length=MAX_TEXT)
    style: TextOverlayStyle | None = None
    sound_id: int | None = None
    volume: int = Field(100, ge=0, le=200)
    fade_in_s: float = Field(0.0, ge=0, le=10)
    fade_out_s: float = Field(0.0, ge=0, le=10)


class ItemUpdate(BaseModel):
    """Cambios parciales: solo los campos que se envían."""

    track_id: int | None = None  # moverlo a otra pista del mismo tipo
    start_s: float | None = Field(default=None, ge=0)
    duration_s: float | None = Field(default=None, ge=MIN_ITEM_S, le=3600)
    text: str | None = Field(default=None, max_length=MAX_TEXT)
    style: TextOverlayStyle | None = None
    sound_id: int | None = None
    volume: int | None = Field(default=None, ge=0, le=200)
    fade_in_s: float | None = Field(default=None, ge=0, le=10)
    fade_out_s: float | None = Field(default=None, ge=0, le=10)

    @model_validator(mode="after")
    def not_empty(self) -> "ItemUpdate":
        if not self.model_fields_set:
            raise ValueError("No hay cambios")
        return self


class ItemRead(BaseModel):
    id: int
    track_id: int
    start_s: float
    duration_s: float
    text: str | None
    style: TextOverlayStyle | None
    sound_id: int | None
    sound_title: str | None
    sound_url: str | None
    sound_duration_s: float | None
    volume: int
    fade_in_s: float
    fade_out_s: float


class TrackRead(BaseModel):
    id: int
    kind: TrackKind
    name: str
    position: int
    items: list[ItemRead]


class EffectUpdate(BaseModel):
    effect: str
