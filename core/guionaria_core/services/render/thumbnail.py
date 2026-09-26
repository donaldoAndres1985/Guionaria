"""Miniatura sugerida (sección 16): un fotograma del video con el título encima (Pillow)."""

import subprocess
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from ..timeline.model import TimelineModel

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def pick_source(m: TimelineModel) -> tuple[Path, float] | None:
    """Primera escena con medio (la portada suele ser la imagen más fuerte): el archivo original
    y el instante dentro de él. Se usa el original para que no salgan subtítulos quemados."""
    for span in m.scenes:
        c = span.clip
        if c and c.path.exists():
            return c.path, (c.source_in + c.duration / 2) / m.fps if c.kind == "video" else 0.0
    return None


def compose(
    frame: Image.Image, title: str, size: tuple[int, int], font_path: str | None
) -> Image.Image:
    """Recorta al tamaño de la miniatura, oscurece abajo y escribe el título en grande."""
    w, h = size
    img = ImageOps.fit(frame.convert("RGB"), size, Image.Resampling.LANCZOS)
    shade = Image.new("L", (1, h))
    for y in range(h):
        # Degradado de transparente (arriba) a 80 % de negro (abajo).
        shade.putpixel((0, y), int(max(0, (y / h - 0.35) / 0.65) * 205))
    black = Image.new("RGB", size, (0, 0, 0))
    img = Image.composite(black, img, shade.resize(size))

    font_size = int(min(w, h) * (0.11 if w > h else 0.085))
    try:
        font = (
            ImageFont.truetype(font_path, font_size)
            if font_path
            else ImageFont.load_default(font_size)
        )
    except OSError:
        font = ImageFont.load_default(font_size)
    chars = max(int(w / (font_size * 0.55)), 10)
    lines = textwrap.wrap(title.upper(), width=chars)[:3]
    draw = ImageDraw.Draw(img)
    line_h = int(font_size * 1.1)
    y = h - int(h * 0.07) - line_h * len(lines)
    for line in lines:
        draw.text(
            (int(w * 0.06), y),
            line,
            font=font,
            fill=(255, 255, 255),
            stroke_width=max(font_size // 18, 2),
            stroke_fill=(0, 0, 0),
        )
        y += line_h
    # Franja naranja de la marca a la izquierda del título.
    draw.rectangle(
        (
            int(w * 0.035),
            h - int(h * 0.07) - line_h * len(lines),
            int(w * 0.045),
            h - int(h * 0.07),
        ),
        fill=(255, 122, 26),
    )
    return img


def _frame(source: Path, at: float, out: Path) -> bool:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            f"{at:.2f}",
            "-i",
            str(source),
            "-frames:v",
            "1",
            str(out),
        ],
        capture_output=True,
        creationflags=_NO_WINDOW,
    )
    return proc.returncode == 0 and out.exists()


def make_thumbnail(m: TimelineModel, video: Path, dest: Path, font_path: str | None) -> Path | None:
    frame_file = dest.with_name(".fotograma.png")
    picked = pick_source(m)
    ok = False
    if picked and picked[0].suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
        frame_file = picked[0]
        ok = True
    elif picked:
        ok = _frame(picked[0], picked[1], frame_file)
    if not ok:  # sin medios: un fotograma del video renderizado
        ok = _frame(video, min(1.0, m.duration / m.fps / 2), frame_file)
    if not ok:
        return None
    try:
        with Image.open(frame_file) as frame:
            size = (1280, 720) if m.width > m.height else (1080, 1920)
            compose(frame, m.title, size, font_path).save(dest, "JPEG", quality=90)
    finally:
        if frame_file.name == ".fotograma.png":
            frame_file.unlink(missing_ok=True)
    return dest
