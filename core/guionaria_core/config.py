r"""Rutas de datos y ajustes de usuario.

Todo vive en GUIONARIA_HOME (por defecto %USERPROFILE%\Guionaria), fuera del repo.
Las claves de API se guardan en config/settings.json, nunca en el código.
"""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

HOME_ENV = "GUIONARIA_HOME"


@dataclass(frozen=True)
class Paths:
    home: Path

    @property
    def db(self) -> Path:
        return self.home / "guionaria.db"

    @property
    def config_dir(self) -> Path:
        return self.home / "config"

    @property
    def settings_file(self) -> Path:
        return self.config_dir / "settings.json"

    @property
    def prompts_dir(self) -> Path:
        return self.config_dir / "prompts"

    @property
    def channels_dir(self) -> Path:
        return self.home / "channels"

    @property
    def library_dir(self) -> Path:
        return self.home / "library"


def get_paths() -> Paths:
    home = os.environ.get(HOME_ENV) or str(Path.home() / "Guionaria")
    return Paths(home=Path(home).expanduser().resolve())


def ensure_home(paths: Paths | None = None) -> Paths:
    """Crea el árbol de carpetas de la sección 8 de SPEC.md si no existe."""
    paths = paths or get_paths()
    for folder in (
        paths.config_dir,
        paths.prompts_dir,
        paths.channels_dir,
        paths.library_dir / "sfx",
        paths.library_dir / "music",
    ):
        folder.mkdir(parents=True, exist_ok=True)
    return paths


class ApiKeys(BaseModel):
    pexels: str = ""
    pixabay: str = ""
    unsplash: str = ""
    freesound: str = ""
    elevenlabs: str = ""


class ElevenLabsPrefs(BaseModel):
    """Últimos ajustes usados con ElevenLabs (se proponen al volver a generar)."""

    voice_id: str = ""
    voice_name: str = ""
    model_id: str = "eleven_multilingual_v2"
    stability: float = 0.5
    similarity_boost: float = 0.75
    style: float = 0.0
    speed: float = 1.0


HEX = r"^#[0-9A-Fa-f]{6}$"


class SubtitleStyle(BaseModel):
    """Estilo de los subtítulos quemados en el render (se recuerda el último usado)."""

    uppercase: bool = True
    words_per_line: int = Field(0, ge=0, le=12)  # 0 = automático (3 en vertical, 6 en horizontal)
    font: Literal["Arial", "Montserrat", "Impact", "Verdana", "Segoe UI"] = "Arial"
    italic: bool = False
    # Contorno: borde grueso, sombra suave (estilo reel) o ambos.
    edge: Literal["outline", "shadow", "both"] = "outline"
    # La palabra que se dice «salta» (crece y vuelve a su tamaño).
    animation: Literal["none", "pop"] = "none"
    size: Literal["small", "medium", "large"] = "medium"
    position: Literal["bottom", "middle"] = "bottom"
    text_color: str = Field("#FFFFFF", pattern=HEX)
    outline_color: str = Field("#000000", pattern=HEX)
    highlight: bool = True  # resaltar la palabra que se está diciendo
    highlight_color: str = Field("#FFD400", pattern=HEX)
    background: bool = False  # caja semitransparente detrás del texto


class TextStyle(BaseModel):
    """Estilo del texto en pantalla de las escenas (títulos, fechas, datos). Se recuerda."""

    font: Literal["Arial", "Montserrat", "Impact", "Verdana", "Segoe UI"] = "Montserrat"
    size: Literal["small", "medium", "large"] = "medium"
    uppercase: bool = False
    # Cómo entra el texto: aparecer, pop (crece y rebota), deslizar hacia arriba o letra a letra.
    animation: Literal["none", "fade", "pop", "slide", "typewriter"] = "pop"
    box: bool = False  # caja oscura detrás del texto
    text_color: str = Field("#FFFFFF", pattern=HEX)


class AppSettings(BaseModel):
    claude_model: str = ""  # vacío = el modelo por defecto de la CLI (alias: sonnet, opus, haiku)
    searxng_url: str = "http://127.0.0.1:8888"
    whisper_model: str = "small"
    tts_engine: str = "piper"  # motor por defecto (piper | elevenlabs): el último usado
    tts_voice: str = ""
    download_parallelism: int = Field(default=4, ge=1, le=16)
    ui_language: str = "es"
    theme: str = "dark"
    api_keys: ApiKeys = Field(default_factory=ApiKeys)
    elevenlabs: ElevenLabsPrefs = Field(default_factory=ElevenLabsPrefs)
    # Abrir «Ajustar tramo» tras «Descargar y aprobar» si el clip dura más que la escena.
    trim_after_download: bool = False
    # «Investigar con fuentes»: tope de búsquedas web por caso (páginas leídas = el doble).
    research_max_searches: int = Field(default=6, ge=2, le=15)
    subtitle_style: SubtitleStyle = Field(default_factory=SubtitleStyle)
    text_style: TextStyle = Field(default_factory=TextStyle)


def load_settings(paths: Paths | None = None) -> AppSettings:
    paths = paths or get_paths()
    if not paths.settings_file.exists():
        return AppSettings()
    data = json.loads(paths.settings_file.read_text(encoding="utf-8"))
    return AppSettings.model_validate(data)


def save_settings(settings: AppSettings, paths: Paths | None = None) -> None:
    paths = ensure_home(paths)
    tmp = paths.settings_file.with_suffix(".json.tmp")
    tmp.write_text(settings.model_dump_json(indent=2), encoding="utf-8")
    tmp.replace(paths.settings_file)
