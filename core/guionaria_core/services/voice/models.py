"""Modelos de voz (Piper) y de transcripción (Whisper): se descargan la primera vez a
GUIONARIA_HOME/models y se reutilizan. El catálogo de voces es el oficial de Piper."""

import asyncio
import json
import time
from pathlib import Path

import httpx
from pydantic import BaseModel

from ...config import get_paths
from ...util.paths import check_path_length
from ..errors import DomainError
from ..jobs import JobContext
from ..media.http import http_client
from ..media.service import DownloadError, fetch_to

PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
CATALOG_URL = PIPER_BASE + "voices.json"
CATALOG_TTL_S = 7 * 24 * 3600
DEFAULT_VOICE = "es_MX-claude-high"
WHISPER_SIZES = ("tiny", "base", "small", "medium")

COUNTRY = {"Mexico": "México", "Spain": "España", "Argentina": "Argentina"}
QUALITY = {"x_low": "muy baja", "low": "baja", "medium": "media", "high": "alta"}

# Respaldo sin conexión: voces en español del catálogo oficial (rhasspy/piper-voices).
_FALLBACK = [
    ("es_MX-claude-high", "Mexico", "high", 1, 63),
    ("es_MX-ald-medium", "Mexico", "medium", 1, 63),
    ("es_MX-ald-x_low", "Mexico", "x_low", 1, 21),
    ("es_AR-daniela-high", "Argentina", "high", 1, 114),
    ("es_ES-davefx-medium", "Spain", "medium", 1, 63),
    ("es_ES-sharvard-medium", "Spain", "medium", 2, 77),
    ("es_ES-carlfm-x_low", "Spain", "x_low", 1, 28),
    ("es_ES-mls_10246-low", "Spain", "low", 1, 63),
    ("es_ES-mls_9972-low", "Spain", "low", 1, 63),
]


class VoiceInfo(BaseModel):
    id: str
    label: str
    country: str
    quality: str
    speakers: int
    size_mb: int
    path: str  # ruta del .onnx dentro del repositorio de voces
    installed: bool


def models_dir() -> Path:
    return get_paths().home / "models"


def voice_files(voice_id: str) -> tuple[Path, Path]:
    folder = models_dir() / "piper"
    return folder / f"{voice_id}.onnx", folder / f"{voice_id}.onnx.json"


def _info(voice_id: str, country: str, quality: str, speakers: int, size_mb: int, path: str):
    name = voice_id.split("-")[1]
    onnx, cfg = voice_files(voice_id)
    return VoiceInfo(
        id=voice_id,
        label=f"{COUNTRY.get(country, country)} · {name} (calidad {QUALITY.get(quality, quality)})",
        country=COUNTRY.get(country, country),
        quality=quality,
        speakers=speakers,
        size_mb=size_mb,
        path=path,
        installed=onnx.exists() and cfg.exists(),
    )


def _fallback() -> list[VoiceInfo]:
    out = []
    for vid, country, quality, speakers, size in _FALLBACK:
        lang, name = vid.split("-")[0], vid.split("-")[1]
        path = f"es/{lang}/{name}/{quality}/{vid}.onnx"
        out.append(_info(vid, country, quality, speakers, size, path))
    return out


def _parse(catalog: dict) -> list[VoiceInfo]:
    out = []
    for vid, v in catalog.items():
        if v.get("language", {}).get("family") != "es":
            continue
        onnx = next((f for f in v.get("files", {}) if f.endswith(".onnx")), None)
        if not onnx:
            continue
        out.append(
            _info(
                vid,
                v["language"].get("country_english", ""),
                v.get("quality", ""),
                v.get("num_speakers", 1),
                round(v["files"][onnx].get("size_bytes", 0) / 1e6),
                onnx,
            )
        )
    order = {"Mexico": 0, "México": 0, "Argentina": 1}
    quality_rank = {"high": 0, "medium": 1, "low": 2, "x_low": 3}
    return sorted(
        out, key=lambda v: (order.get(v.country, 2), quality_rank.get(v.quality, 9), v.id)
    )


async def voice_catalog() -> list[VoiceInfo]:
    """Catálogo oficial (se guarda una semana); sin conexión, la lista incluida en la app."""
    cache = models_dir() / "piper" / "voices.json"
    if cache.exists() and time.time() - cache.stat().st_mtime < CATALOG_TTL_S:
        return _parse(json.loads(cache.read_text(encoding="utf-8"))) or _fallback()
    try:
        async with http_client() as client:
            resp = await client.get(CATALOG_URL)
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError):
        return _fallback()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data), encoding="utf-8")
    return _parse(data) or _fallback()


async def ensure_voice(voice_id: str, ctx: JobContext | None = None) -> Path:
    onnx, cfg = voice_files(voice_id)
    if onnx.exists() and cfg.exists():
        return onnx
    voice = next((v for v in await voice_catalog() if v.id == voice_id), None)
    if not voice:
        raise DomainError(f"No existe la voz «{voice_id}» en el catálogo de Piper")
    if ctx:
        ctx.progress(
            0.03, f"Descargando la voz {voice.label} ({voice.size_mb} MB, solo la primera vez)…"
        )
    onnx.parent.mkdir(parents=True, exist_ok=True)
    check_path_length(cfg)
    try:
        async with http_client() as client:
            await fetch_to(client, PIPER_BASE + voice.path + ".json", cfg)
            await fetch_to(client, PIPER_BASE + voice.path, onnx)
    except DownloadError as exc:
        onnx.unlink(missing_ok=True)
        cfg.unlink(missing_ok=True)
        raise DomainError(f"No se pudo descargar la voz: {exc}") from exc
    return onnx


def whisper_dir(size: str) -> Path:
    return models_dir() / "whisper" / size


def _download_whisper(size: str) -> Path:
    from faster_whisper import download_model

    target = whisper_dir(size)
    target.mkdir(parents=True, exist_ok=True)
    return Path(download_model(size, output_dir=str(target)))


# Los tests reemplazan la descarga del modelo de Whisper.
whisper_downloader = _download_whisper


async def ensure_whisper(size: str, ctx: JobContext | None = None) -> Path:
    if size not in WHISPER_SIZES:
        raise DomainError(f"Modelo de Whisper desconocido: {size}")
    target = whisper_dir(size)
    if (target / "model.bin").exists():
        return target
    if ctx:
        ctx.progress(0.05, f"Descargando el modelo de Whisper «{size}» (solo la primera vez)…")
    try:
        return await asyncio.to_thread(whisper_downloader, size)
    except Exception as exc:  # errores de red de huggingface_hub
        raise DomainError(f"No se pudo descargar el modelo de Whisper: {exc}") from exc
