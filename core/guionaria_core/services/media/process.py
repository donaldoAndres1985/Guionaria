"""Post-proceso de medios (sección 5.8): medidas, duración, miniatura y hash perceptual."""

import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
THUMB_SIZE = 480


@dataclass
class MediaInfo:
    width: int | None
    height: int | None
    duration_s: float | None
    phash: str | None


def orientation(width: int | None, height: int | None) -> str | None:
    if not width or not height:
        return None
    if width > height:
        return "landscape"
    return "portrait" if height > width else "square"


def _run(args: list[str], timeout: int = 60) -> subprocess.CompletedProcess | None:
    exe = shutil.which(args[0])
    if not exe:
        return None
    try:
        return subprocess.run(
            [exe, *args[1:]], capture_output=True, timeout=timeout, creationflags=_NO_WINDOW
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def _image_hash(img: Image.Image) -> str:
    """dHash de 64 bits (16 hex) solo con Pillow: detecta duplicados sin arrastrar
    numpy/scipy al sidecar empaquetado (imagehash sumaba ~45 MB)."""
    small = img.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    px = list(small.get_flattened_data())
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (px[row * 9 + col] > px[row * 9 + col + 1])
    return f"{bits:016x}"


def image_info(path: Path) -> MediaInfo:
    try:
        with Image.open(path) as img:
            return MediaInfo(img.width, img.height, None, _image_hash(img))
    except (UnidentifiedImageError, OSError):
        return MediaInfo(None, None, None, None)


def video_info(path: Path) -> MediaInfo:
    proc = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
            str(path),
        ]
    )
    if not proc or proc.returncode != 0:
        return MediaInfo(None, None, None, None)
    data = json.loads(proc.stdout or b"{}")
    stream = (data.get("streams") or [{}])[0]
    duration = (data.get("format") or {}).get("duration")
    return MediaInfo(
        stream.get("width"),
        stream.get("height"),
        round(float(duration), 2) if duration else None,
        None,
    )


def make_thumbnail(src: Path, dest: Path, kind: str, duration_s: float | None = None) -> str | None:
    """Miniatura JPG de 480 px. Devuelve el hash perceptual del fotograma si es un video."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Si ya existía, puede ser un enlace duro compartido con otro proyecto: se quita la entrada
    # para escribir un archivo nuevo en vez de sobrescribir el compartido.
    dest.unlink(missing_ok=True)
    if kind == "image":
        try:
            with Image.open(src) as img:
                img = img.convert("RGB")
                img.thumbnail((THUMB_SIZE, THUMB_SIZE))
                img.save(dest, "JPEG", quality=82)
        except (UnidentifiedImageError, OSError):
            return None
        return None

    at = min(1.0, (duration_s or 2.0) / 2)
    proc = _run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            f"{at:.2f}",
            "-i",
            str(src),
            "-frames:v",
            "1",
            "-vf",
            f"scale={THUMB_SIZE}:-2",
            str(dest),
        ]
    )
    if not proc or proc.returncode != 0 or not dest.exists():
        return None
    try:
        with Image.open(dest) as frame:
            return _image_hash(frame)
    except (UnidentifiedImageError, OSError):
        return None


def extension_for(url: str, content_type: str | None, kind: str) -> str:
    known = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm"}
    suffix = Path(url.split("?")[0]).suffix.lower()
    if suffix in known:
        return ".jpg" if suffix == ".jpeg" else suffix
    by_type = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
    }
    return by_type.get(
        (content_type or "").split(";")[0].strip(), ".mp4" if kind == "video" else ".jpg"
    )
