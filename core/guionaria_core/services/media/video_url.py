"""Video desde una URL con yt-dlp (secciones 5.7 y 7): noticias, YouTube, redes.

Se permite bajar solo un fragmento (inicio–fin): el material real se usa en tramos cortos, con
comentario y crédito (sección 19). Queda con origen manual, la página, el autor del canal y la
marca «Derechos: revisar».
"""

import asyncio
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from ...util.slug import slugify
from ..errors import DomainError
from ..jobs import JobContext
from ..projects import get_project
from .manual import import_file
from .providers import RIGHTS_REVIEW
from .service import _open_project, get_scene

FRAGMENT_LICENSE = f"{RIGHTS_REVIEW} (fragmento con comentario)"
# Hasta 1080p en MP4; si no hay MP4, lo mejor disponible (ffmpeg lo une).
FORMAT = "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b"


def _ytdlp_download(
    url: str,
    out_dir: Path,
    start_s: float | None,
    end_s: float | None,
    progress: Callable[[float], None],
) -> dict[str, Any]:
    import yt_dlp
    from yt_dlp.utils import download_range_func

    def hook(d: dict) -> None:
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if d.get("status") == "downloading" and total:
            progress(min(0.95, d.get("downloaded_bytes", 0) / total))

    opts: dict[str, Any] = {
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "format": FORMAT,
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "ffmpeg_location": str(Path(shutil.which("ffmpeg")).parent),
    }
    if start_s is not None and end_s is not None:
        opts["download_ranges"] = download_range_func(None, [(start_s, end_s)])
        opts["force_keyframes_at_cuts"] = True

    with yt_dlp.YoutubeDL(opts) as ydl:
        try:
            info = ydl.extract_info(url, download=True)
        except yt_dlp.utils.DownloadError as exc:
            message = str(exc).replace("ERROR: ", "").strip()
            raise DomainError(f"No se pudo descargar el video: {message[:300]}") from exc
        downloads = info.get("requested_downloads") or [{}]
        path = downloads[0].get("filepath") or ydl.prepare_filename(info)
    return {
        "path": path,
        "title": info.get("title") or "video",
        "uploader": info.get("uploader") or info.get("channel"),
        "webpage_url": info.get("webpage_url") or url,
        "duration": info.get("duration"),
    }


# Los tests reemplazan el descargador para no salir a internet.
downloader: Callable[..., dict[str, Any]] = _ytdlp_download


def validate(url: str, start_s: float | None, end_s: float | None) -> None:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise DomainError("La dirección debe empezar por http:// o https://")
    if (start_s is None) != (end_s is None):
        raise DomainError("Para bajar un fragmento indica inicio y fin")
    if start_s is not None and (start_s < 0 or end_s <= start_s):
        raise DomainError("El fin del fragmento debe ser mayor que el inicio")


async def download_video_url(
    session_factory,
    scene_id: int,
    url: str,
    start_s: float | None,
    end_s: float | None,
    ctx: JobContext,
) -> dict:
    validate(url, start_s, end_s)
    with session_factory() as session:
        scene = get_scene(session, scene_id)
        _open_project(session, scene.project_id)
        get_project(session, scene.project_id)
    if not shutil.which("ffmpeg"):
        raise DomainError(
            "Hace falta FFmpeg para unir y recortar el video (Ajustes → Dependencias)"
        )

    fragment = f" (fragmento {start_s:g}–{end_s:g} s)" if start_s is not None else ""
    ctx.progress(0.03, f"Descargando el video{fragment}…")
    loop = asyncio.get_running_loop()

    def report(p: float) -> None:
        loop.call_soon_threadsafe(ctx.progress, 0.05 + p * 0.85, f"Descargando el video{fragment}…")

    with tempfile.TemporaryDirectory(prefix="guionaria-video-") as tmp:
        info = await asyncio.to_thread(downloader, url, Path(tmp), start_s, end_s, report)
        path = Path(info["path"])
        if not path.exists():
            raise DomainError("yt-dlp terminó pero no dejó el archivo de video")
        ctx.progress(0.92, "Procesando el video…")
        with session_factory() as session:
            media = await import_file(
                session,
                scene_id,
                path,
                original_name=f"{slugify(info['title'])}{path.suffix or '.mp4'}",
                url=info["webpage_url"],
                author=info["uploader"],
                license=FRAGMENT_LICENSE,
                move=True,
            )
    asset = media.candidates[-1].asset
    return {
        "asset_id": asset.id if asset else None,
        "title": info["title"],
        "duration": asset.duration_s if asset else info.get("duration"),
        "approved": any(a.asset.id == (asset.id if asset else None) for a in media.approved),
    }
