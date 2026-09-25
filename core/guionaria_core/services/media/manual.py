"""Medios agregados a mano (sección 5.7): archivos arrastrados, pegados o desde una URL.

Se procesan igual que las descargas (miniatura, medidas, hash) y quedan con origen `manual`
y la URL si la hay. Soltados sobre un candidato que falló, conservan su autor y licencia.
"""

import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from sqlmodel import Session

from ...models import SceneCandidate
from ...schemas.media import SceneMediaRead
from ...util.paths import check_path_length
from ...util.slug import slugify
from ..errors import DomainError
from ..projects import project_dir
from . import process
from .http import http_client
from .service import (
    DownloadError,
    _approved,
    _open_project,
    approve_asset,
    create_asset,
    fetch_to,
    get_scene,
    process_file,
    scene_media,
)

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
# Video desde redes y YouTube: llega con yt-dlp en la Fase 2.
VIDEO_SITES = (
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "instagram.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "vimeo.com",
)
MAX_HTML = 512 * 1024


def kind_for(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in IMAGE_EXT:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    raise DomainError(
        f"Formato no admitido ({ext or 'sin extensión'}). "
        "Usa imágenes (JPG, PNG, WebP) o video (MP4, MOV, WebM)."
    )


def _target(folder: Path, position: int, stem: str, ext: str) -> Path:
    base = f"{position:03d}_manual_{slugify(stem)}"
    dest = folder / f"{base}{ext}"
    n = 2
    while dest.exists():
        dest = folder / f"{base}-{n}{ext}"
        n += 1
    return dest


async def import_file(
    session: Session,
    scene_id: int,
    source: Path,
    *,
    original_name: str | None = None,
    url: str | None = None,
    candidate_id: int | None = None,
    move: bool = False,
) -> SceneMediaRead:
    scene = get_scene(session, scene_id)
    project = _open_project(session, scene.project_id)
    if not source.is_file():
        raise DomainError("No se encontró el archivo")
    name = Path(original_name or source.name)
    kind = kind_for(name)

    candidate = None
    if candidate_id is not None:
        candidate = session.get(SceneCandidate, candidate_id)
        if not candidate or candidate.scene_id != scene_id:
            raise DomainError("Ese candidato no es de esta escena")

    folder = project_dir(project) / "media" / "manual"
    folder.mkdir(parents=True, exist_ok=True)
    ext = ".jpg" if name.suffix.lower() == ".jpeg" else name.suffix.lower()
    dest = _target(folder, scene.position, name.stem, ext)
    check_path_length(dest)
    if move:
        shutil.move(str(source), dest)
    else:
        shutil.copy2(source, dest)

    processed = await process_file(dest, kind)
    if kind == "image" and processed.info.width is None:
        dest.unlink(missing_ok=True)
        raise DomainError("El archivo no es una imagen válida")

    if candidate:
        # El usuario bajó a mano el archivo de un candidato que falló: se conserva su origen.
        asset = create_asset(
            session,
            processed,
            provider=candidate.provider,
            provider_id=candidate.provider_id,
            page_url=candidate.page_url,
            file_url=candidate.full_url,
            author=candidate.author,
            license=candidate.license,
        )
        candidate.asset_id = asset.id
        candidate.download_status = "manual"
        candidate.error = None
    else:
        asset = create_asset(
            session,
            processed,
            provider="manual",
            provider_id=None,
            page_url=url,
            file_url=url,
            author=None,
            license=None,
        )
        session.add(
            SceneCandidate(
                scene_id=scene_id,
                provider="manual",
                kind=kind,
                page_url=url,
                full_url=url,
                width=asset.width,
                height=asset.height,
                duration_s=asset.duration_s,
                selected=1,
                download_status="manual",
                asset_id=asset.id,
            )
        )
    session.commit()

    # Soltado sobre la escena: si todavía no tiene medio principal, queda aprobado.
    if not any(r.role == "main" for r in _approved(session, scene_id)):
        return approve_asset(session, scene_id, asset.id, "main")
    return scene_media(session, scene_id)


def _meta_media(html: str, base: str) -> str | None:
    for prop in ("og:video:url", "og:video", "og:image:secure_url", "og:image", "twitter:image"):
        pattern = (
            rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)'
            rf'|<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']'
        )
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return urljoin(base, match.group(1) or match.group(2))
    return None


async def import_url(
    session: Session, scene_id: int, url: str, candidate_id: int | None = None
) -> SceneMediaRead:
    """URL directa de imagen/video, o página: se toma su imagen principal (og:image)."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise DomainError("La dirección debe empezar por http:// o https://")
    host = parsed.netloc.lower().removeprefix("www.")
    if any(host == s or host.endswith("." + s) for s in VIDEO_SITES):
        raise DomainError(
            "Descargar video de YouTube o redes sociales llega en la Fase 2. Por ahora descárgalo "
            "y arrastra el archivo."
        )
    scene = get_scene(session, scene_id)
    _open_project(session, scene.project_id)

    with tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
        async with http_client() as client:
            media_url, page_url = url, None
            try:
                head = await client.get(url, headers={"Range": f"bytes=0-{MAX_HTML}"})
            except httpx.HTTPError as exc:
                raise DomainError(f"No se pudo abrir la dirección: {type(exc).__name__}") from exc
            ctype = head.headers.get("content-type", "").split(";")[0].strip().lower()
            if head.status_code >= 400:
                raise DomainError(f"La dirección respondió con error {head.status_code}")
            if ctype == "text/html":
                found = _meta_media(head.text[:MAX_HTML], str(head.url))
                if not found:
                    raise DomainError(
                        "La página no tiene una imagen principal. Descarga el archivo y arrástralo."
                    )
                media_url, page_url = found, url
            elif not ctype.startswith(("image/", "video/")):
                raise DomainError("La dirección no es una imagen, un video ni una página web")

            kind = "video" if ctype.startswith("video/") else "image"
            ext = process.extension_for(media_url, None if page_url else ctype, kind)
            stem = Path(urlparse(media_url).path).stem or "desde-url"
            target = Path(tmp) / f"{stem}{ext}"
            try:
                await fetch_to(client, media_url, target)
            except DownloadError as exc:
                raise DomainError(f"No se pudo descargar: {exc}") from exc

        return await import_file(
            session,
            scene_id,
            target,
            original_name=target.name,
            url=page_url or media_url,
            candidate_id=candidate_id,
            move=True,
        )
