"""Verificación de claves de API y fuentes (Ajustes → Claves de API).

Cada prueba hace la búsqueda más pequeña posible contra el proveedor y traduce la respuesta a
un estado entendible: clave válida, rechazada, límite alcanzado o sin conexión. Se puede probar
una clave antes de guardarla; si no se envía, se usa la guardada en settings.json.
"""

import time
from typing import Literal

import httpx
from pydantic import BaseModel

from ..config import load_settings
from .errors import NotFound
from .media.http import http_client

KeyProvider = Literal["pexels", "pixabay", "unsplash", "freesound", "searxng"]
KeyStatus = Literal["valid", "invalid", "missing", "rate_limited", "unreachable", "error"]

PROVIDERS: tuple[str, ...] = ("pexels", "pixabay", "unsplash", "freesound", "searxng")
LABELS = {
    "pexels": "Pexels",
    "pixabay": "Pixabay",
    "unsplash": "Unsplash",
    "freesound": "Freesound",
    "searxng": "SearXNG",
}


class KeyTestRequest(BaseModel):
    value: str | None = None  # clave (o URL en SearXNG); None = la guardada


class KeyTestResult(BaseModel):
    provider: str
    status: KeyStatus
    message: str
    latency_ms: int | None = None
    quota_remaining: int | None = None  # peticiones restantes en la ventana actual, si lo informa


def _request(provider: str, value: str) -> tuple[str, dict, dict]:
    """URL, parámetros y cabeceras de la búsqueda mínima de cada proveedor."""
    if provider == "pexels":
        return (
            "https://api.pexels.com/v1/search",
            {"query": "nature", "per_page": 1},
            {"Authorization": value},
        )
    if provider == "pixabay":
        # Pixabay exige per_page entre 3 y 200.
        return "https://pixabay.com/api/", {"key": value, "q": "nature", "per_page": 3}, {}
    if provider == "unsplash":
        return (
            "https://api.unsplash.com/search/photos",
            {"query": "nature", "per_page": 1},
            {"Authorization": f"Client-ID {value}"},
        )
    if provider == "freesound":
        return (
            "https://freesound.org/apiv2/search/text/",
            {"query": "rain", "page_size": 1, "fields": "id", "token": value},
            {},
        )
    return f"{value.rstrip('/')}/search", {"q": "test", "format": "json"}, {}


def _quota(resp: httpx.Response) -> int | None:
    raw = resp.headers.get("x-ratelimit-remaining")
    try:
        return int(raw) if raw is not None else None
    except ValueError:
        return None


def _saved_value(provider: str) -> str:
    settings = load_settings()
    if provider == "searxng":
        return settings.searxng_url
    return getattr(settings.api_keys, provider)


def _interpret(provider: str, resp: httpx.Response) -> tuple[KeyStatus, str]:
    label = LABELS[provider]
    code = resp.status_code
    if provider == "searxng":
        if code == 403:
            return "error", "Responde, pero falta activar el formato json en settings.yml"
        if resp.is_success:
            return "valid", "SearXNG responde y entrega resultados en JSON"
        return "error", f"SearXNG respondió con error {code}"
    # Pixabay responde 400 "Invalid or missing API key" cuando la clave no existe.
    if code in (401, 403) or (provider == "pixabay" and code == 400 and "key" in resp.text.lower()):
        return "invalid", f"{label} rechazó la clave: revisa que la copiaste completa"
    if code == 429:
        return "rate_limited", f"La clave es válida, pero se alcanzó el límite de {label} por ahora"
    if resp.is_success:
        return "valid", f"Clave verificada: {label} respondió correctamente"
    return "error", f"{label} respondió con error {code}"


async def test_key(provider: str, value: str | None) -> KeyTestResult:
    if provider not in PROVIDERS:
        raise NotFound(f"Proveedor desconocido: {provider}")
    value = (value if value is not None else _saved_value(provider)).strip()
    if not value:
        what = "la URL" if provider == "searxng" else "la clave"
        return KeyTestResult(provider=provider, status="missing", message=f"Falta {what}")

    url, params, headers = _request(provider, value)
    start = time.perf_counter()
    try:
        async with http_client() as client:
            resp = await client.get(url, params=params, headers=headers, timeout=10)
    except httpx.HTTPError as exc:
        where = f" en {value}" if provider == "searxng" else ""
        return KeyTestResult(
            provider=provider,
            status="unreachable",
            message=f"{LABELS[provider]} no responde{where} ({type(exc).__name__})",
        )
    latency = round((time.perf_counter() - start) * 1000)
    status, message = _interpret(provider, resp)
    return KeyTestResult(
        provider=provider,
        status=status,
        message=message,
        latency_ms=latency,
        quota_remaining=_quota(resp) if status in ("valid", "rate_limited") else None,
    )
