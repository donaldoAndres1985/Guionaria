"""Fuentes de medios gratuitas (sección 7 de SPEC.md).

Stock: Pexels, Pixabay, Unsplash. Material real: SearXNG (imágenes web), Wikimedia Commons y
Openverse (licencias CC).

Cada proveedor devuelve candidatos normalizados. La orientación sale del formato del proyecto:
video 16:9 → horizontal, reel 9:16 → vertical (sección 6).
"""

import hashlib
import html
import re
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
    tracking_url: str | None = None  # Unsplash pide avisar cada descarga a esta URL

    def to_dict(self) -> dict:
        return asdict(self)


class ProviderError(DomainError):
    status_code = 502


# Material sin licencia conocida (imágenes web, fragmentos de video): se marca para revisar.
RIGHTS_REVIEW = "Derechos: revisar"


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
    kinds = frozenset({"image", "video"})
    needs_key = True

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
    kinds = frozenset({"image", "video"})
    needs_key = True

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


# --- Unsplash (https://unsplash.com/documentation) ---


class Unsplash:
    name = "unsplash"
    label = "Unsplash"
    license = "Unsplash License"
    kinds = frozenset({"image"})
    needs_key = True

    def __init__(self, api_key: str):
        self.api_key = api_key

    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Client-ID {self.api_key}"}

    async def search(self, client, query, kind, orientation, page, per_page) -> list[Candidate]:
        params: dict[str, str | int] = {"query": query, "page": page, "per_page": per_page}
        if orientation:
            params["orientation"] = orientation
        data = _check(
            await client.get(
                "https://api.unsplash.com/search/photos", params=params, headers=self.auth()
            ),
            self.label,
        )
        out = []
        for r in data.get("results", []):
            urls, links = r.get("urls", {}), r.get("links", {})
            out.append(
                Candidate(
                    provider=self.name,
                    provider_id=str(r["id"]),
                    kind="image",
                    preview_url=urls.get("small") or urls.get("thumb", ""),
                    # Tamaño de trabajo: 1920 px de ancho en vez del original de 20 MB.
                    full_url=(urls.get("raw", "") + "&w=1920&fm=jpg&q=85")
                    if urls.get("raw")
                    else urls.get("full", ""),
                    page_url=links.get("html", ""),
                    width=r.get("width", 0),
                    height=r.get("height", 0),
                    duration_s=None,
                    author=(r.get("user") or {}).get("name"),
                    license=self.license,
                    tracking_url=links.get("download_location"),
                )
            )
        return out


# --- Openverse (https://api.openverse.org/v1/) ---


class Openverse:
    name = "openverse"
    label = "Openverse"
    license = "Creative Commons"
    kinds = frozenset({"image"})
    needs_key = False

    def __init__(self, _key: str = ""):
        pass

    async def search(self, client, query, kind, orientation, page, per_page) -> list[Candidate]:
        params: dict[str, str | int] = {
            "q": query,
            "page": page,
            "page_size": per_page,
            "mature": "false",
        }
        if orientation:
            params["aspect_ratio"] = "wide" if orientation == "landscape" else "tall"
        data = _check(
            await client.get("https://api.openverse.org/v1/images/", params=params), self.label
        )
        out = []
        for r in data.get("results", []):
            lic = (r.get("license") or "").upper()
            version = r.get("license_version") or ""
            license_ = (
                "Dominio público (CC0)" if lic in ("CC0", "PDM") else f"CC {lic} {version}".strip()
            )
            out.append(
                Candidate(
                    provider=self.name,
                    provider_id=str(r["id"]),
                    kind="image",
                    preview_url=r.get("thumbnail") or r.get("url", ""),
                    full_url=r.get("url", ""),
                    page_url=r.get("foreign_landing_url") or r.get("url", ""),
                    width=r.get("width") or 0,
                    height=r.get("height") or 0,
                    duration_s=None,
                    author=r.get("creator"),
                    license=license_,
                )
            )
        return out


# --- Wikimedia Commons (API de MediaWiki) ---


def _strip_html(value: str | None) -> str | None:
    if not value:
        return None
    text = html.unescape(re.sub(r"<[^>]+>", "", value)).strip()
    return text or None


class Wikimedia:
    name = "wikimedia"
    label = "Wikimedia Commons"
    license = "Licencia libre (ver página)"
    kinds = frozenset({"image"})
    needs_key = False

    def __init__(self, _key: str = ""):
        pass

    async def search(self, client, query, kind, orientation, page, per_page) -> list[Candidate]:
        params = {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": f"{query} filetype:bitmap",
            "gsrnamespace": 6,
            "gsrlimit": per_page,
            "gsroffset": (page - 1) * per_page,
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata",
            "iiurlwidth": 640,
        }
        data = _check(
            await client.get("https://commons.wikimedia.org/w/api.php", params=params), self.label
        )
        pages = sorted(
            (data.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 0)
        )
        out = []
        for page_ in pages:
            info = (page_.get("imageinfo") or [{}])[0]
            if not info.get("url"):
                continue
            meta = info.get("extmetadata") or {}
            w, h = info.get("width") or 0, info.get("height") or 0
            if not matches_orientation(w, h, orientation):
                continue
            out.append(
                Candidate(
                    provider=self.name,
                    provider_id=str(page_.get("pageid")),
                    kind="image",
                    preview_url=info.get("thumburl") or info["url"],
                    full_url=info["url"],
                    page_url=info.get("descriptionurl", ""),
                    width=w,
                    height=h,
                    duration_s=None,
                    author=_strip_html((meta.get("Artist") or {}).get("value")),
                    license=(meta.get("LicenseShortName") or {}).get("value") or self.license,
                )
            )
        return out


# --- SearXNG (metabuscador autoalojado, sección 7) ---


class SearXNG:
    name = "searxng"
    label = "SearXNG (web)"
    license = RIGHTS_REVIEW
    kinds = frozenset({"image"})
    needs_key = False

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    async def search(self, client, query, kind, orientation, page, per_page) -> list[Candidate]:
        params = {"q": query, "format": "json", "categories": "images", "pageno": page}
        try:
            resp = await client.get(f"{self.base_url}/search", params=params)
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"SearXNG no responde en {self.base_url}: "
                "arráncalo con Docker (Ajustes → Dependencias)"
            ) from exc
        if resp.status_code == 403:
            raise ProviderError(
                "SearXNG responde, pero falta activar el formato json en settings.yml"
            )
        data = _check(resp, self.label)
        out = []
        for r in data.get("results", []):
            src = r.get("img_src")
            if not src:
                continue
            w = h = 0
            if m := re.match(r"\s*(\d+)\s*[x×]\s*(\d+)", r.get("resolution") or ""):
                w, h = int(m.group(1)), int(m.group(2))
            if w and h and not matches_orientation(w, h, orientation):
                continue
            out.append(
                Candidate(
                    provider=self.name,
                    provider_id=hashlib.sha1(src.encode()).hexdigest()[:12],
                    kind="image",
                    preview_url=r.get("thumbnail_src") or src,
                    full_url=src,
                    page_url=r.get("url") or src,
                    width=w,
                    height=h,
                    duration_s=None,
                    author=r.get("source") or r.get("engine"),
                    license=RIGHTS_REVIEW,
                )
            )
            if len(out) >= per_page:
                break
        return out


PROVIDERS = {
    "pexels": Pexels,
    "pixabay": Pixabay,
    "unsplash": Unsplash,
    "openverse": Openverse,
    "wikimedia": Wikimedia,
    "searxng": SearXNG,
}

# Fuentes por tipo de escena (sección 5.5).
DEFAULTS = {
    "video": ["pexels", "pixabay"],
    "image": ["pexels", "pixabay", "unsplash", "openverse"],
    "real": ["searxng", "wikimedia", "openverse"],
}
