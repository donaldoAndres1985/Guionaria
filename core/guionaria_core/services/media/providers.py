"""Bancos de medios gratuitos (sección 7 de SPEC.md): Pexels y Pixabay.

Cada proveedor devuelve candidatos normalizados. La orientación sale del formato del proyecto:
video 16:9 → horizontal, reel 9:16 → vertical (sección 6).
"""

from dataclasses import asdict, dataclass
from typing import Literal

import httpx

from ..errors import DomainError

Kind = Literal["image", "video"]
Orientation = Literal["landscape", "portrait"]

# Resolución objetivo (lado corto): se elige la variante más cercana a 1080p (sección 5.8).
TARGET_SHORT_SIDE = 1080


@dataclass
class Candidate:
    provider: str
    provider_id: str
    kind: Kind
    preview_url: str  # miniatura
    full_url: str  # archivo a descargar
    page_url: str
    width: int
    height: int
    duration_s: float | None
    author: str | None
    license: str
    video_preview_url: str | None = None  # clip liviano para previsualizar al pasar el mouse

    def to_dict(self) -> dict:
        return asdict(self)


class ProviderError(DomainError):
    status_code = 502


def _check(resp: httpx.Response, name: str) -> dict:
    if resp.status_code in (401, 403):
        raise ProviderError(f"{name} rechazó la clave de API: revísala en Ajustes → Claves de API")
    if resp.status_code == 429:
        raise ProviderError(f"Se alcanzó el límite de búsquedas de {name}; intenta más tarde")
    if resp.status_code >= 400:
        raise ProviderError(f"{name} respondió con error {resp.status_code}")
    return resp.json()


def matches_orientation(width: int, height: int, orientation: Orientation | None) -> bool:
    if orientation is None:
        return True
    return width > height if orientation == "landscape" else height > width


def closest_variant(variants: list[dict], short_side_key=lambda v: min(v["width"], v["height"])):
    """La variante cuyo lado corto está más cerca de 1080 (sin preferir 4K innecesario)."""
    usable = [v for v in variants if v.get("width") and v.get("height")]
    if not usable:
        return None
    return min(usable, key=lambda v: abs(short_side_key(v) - TARGET_SHORT_SIDE))


# --- Pexels (https://www.pexels.com/api/documentation/) ---


class Pexels:
    name = "pexels"
    label = "Pexels"
    license = "Pexels License"

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def search(
        self,
        client: httpx.AsyncClient,
        query: str,
        kind: Kind,
        orientation: Orientation | None,
        page: int,
        per_page: int,
    ) -> list[Candidate]:
        params: dict[str, str | int] = {"query": query, "page": page, "per_page": per_page}
        if orientation:
            params["orientation"] = orientation
        url = (
            "https://api.pexels.com/videos/search"
            if kind == "video"
            else "https://api.pexels.com/v1/search"
        )
        data = _check(
            await client.get(url, params=params, headers={"Authorization": self.api_key}),
            self.label,
        )
        if kind == "video":
            return [c for v in data.get("videos", []) if (c := self._video(v))]
        return [self._photo(p) for p in data.get("photos", [])]

    def _photo(self, p: dict) -> Candidate:
        src = p.get("src", {})
        return Candidate(
            provider=self.name,
            provider_id=str(p["id"]),
            kind="image",
            preview_url=src.get("medium") or src.get("small") or src.get("original"),
            full_url=src.get("original") or src.get("large2x"),
            page_url=p.get("url", ""),
            width=p.get("width", 0),
            height=p.get("height", 0),
            duration_s=None,
            author=p.get("photographer"),
            license=self.license,
        )

    def _video(self, v: dict) -> Candidate | None:
        files = [
            f for f in v.get("video_files", []) if f.get("file_type", "video/mp4") == "video/mp4"
        ]
        best = closest_variant(files)
        if not best:
            return None
        light = min(files, key=lambda f: f.get("width") or 10**6)
        return Candidate(
            provider=self.name,
            provider_id=str(v["id"]),
            kind="video",
            preview_url=v.get("image", ""),
            full_url=best["link"],
            page_url=v.get("url", ""),
            width=best["width"],
            height=best["height"],
            duration_s=float(v["duration"]) if v.get("duration") is not None else None,
            author=(v.get("user") or {}).get("name"),
            license=self.license,
            video_preview_url=light.get("link"),
        )


# --- Pixabay (https://pixabay.com/api/docs/) ---


class Pixabay:
    name = "pixabay"
    label = "Pixabay"
    license = "Pixabay Content License"

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def search(
        self,
        client: httpx.AsyncClient,
        query: str,
        kind: Kind,
        orientation: Orientation | None,
        page: int,
        per_page: int,
    ) -> list[Candidate]:
        params: dict[str, str | int] = {
            "key": self.api_key,
            "q": query[:100],
            "page": page,
            "per_page": max(3, min(per_page, 200)),
            "safesearch": "true",
        }
        if kind == "video":
            data = _check(
                await client.get("https://pixabay.com/api/videos/", params=params), self.label
            )
            # La API de video no filtra por orientación: se filtra por dimensiones.
            found = [c for h in data.get("hits", []) if (c := self._video(h))]
            return [c for c in found if matches_orientation(c.width, c.height, orientation)]

        params["image_type"] = "photo"
        if orientation:
            params["orientation"] = "horizontal" if orientation == "landscape" else "vertical"
        data = _check(await client.get("https://pixabay.com/api/", params=params), self.label)
        return [self._photo(h) for h in data.get("hits", [])]

    def _photo(self, h: dict) -> Candidate:
        return Candidate(
            provider=self.name,
            provider_id=str(h["id"]),
            kind="image",
            preview_url=h.get("webformatURL") or h.get("previewURL", ""),
            full_url=h.get("largeImageURL") or h.get("webformatURL", ""),
            page_url=h.get("pageURL", ""),
            width=h.get("imageWidth", 0),
            height=h.get("imageHeight", 0),
            duration_s=None,
            author=h.get("user"),
            license=self.license,
        )

    def _video(self, h: dict) -> Candidate | None:
        variants = [
            {**v, "name": name} for name, v in (h.get("videos") or {}).items() if v.get("url")
        ]
        best = closest_variant(variants)
        if not best:
            return None
        light = next((v for v in variants if v["name"] == "tiny"), best)
        return Candidate(
            provider=self.name,
            provider_id=str(h["id"]),
            kind="video",
            preview_url=best.get("thumbnail") or light.get("thumbnail", ""),
            full_url=best["url"],
            page_url=h.get("pageURL", ""),
            width=best["width"],
            height=best["height"],
            duration_s=float(h["duration"]) if h.get("duration") is not None else None,
            author=h.get("user"),
            license=self.license,
            video_preview_url=light.get("url"),
        )


PROVIDERS = {"pexels": Pexels, "pixabay": Pixabay}
