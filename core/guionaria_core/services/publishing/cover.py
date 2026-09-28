"""Miniaturas diseñadas con Claude: Claude mira los cuadros del video y decide el cuadro, el
texto, la palabra resaltada, la plantilla y el punto de enfoque; aquí se dibujan con Pillow.

Plantillas:
- impacto: texto enorme con borde grueso y sombra, alto contraste, rótulo rojo opcional.
- documental: sobria, franja oscura abajo con una línea de acento y el rótulo encima.
- expediente: tono frío, texto en cintas tipo archivo policial y un círculo rojo en el foco.
"""

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from ...schemas.publishing import DisenoClaude
from ..render.captions import FONTS_DIR
from ..timeline.model import TimelineModel

FONT = FONTS_DIR / "Montserrat-ExtraBold.ttf"
MAX_FRAMES = 10
PREVIEW_W = 512  # lo que ve Claude (menos tokens)


@dataclass
class Frame:
    number: int  # cuadro_NN.jpg
    source: Path  # medio original (sin subtítulos quemados)
    at: float  # segundo dentro del archivo (0 en fotos)
    scene: int


def pick_frames(m: TimelineModel) -> list[Frame]:
    """Un cuadro por escena con medio (a mitad de la escena), repartidos si son muchas."""
    spans = [s for s in m.scenes if s.clip and s.clip.path.exists()]
    if len(spans) > MAX_FRAMES:
        step = len(spans) / MAX_FRAMES
        spans = [spans[int(i * step)] for i in range(MAX_FRAMES)]
    frames = []
    for i, span in enumerate(spans, start=1):
        c = span.clip
        at = (c.source_in + c.duration / 2) / m.fps if c.kind == "video" else 0.0
        frames.append(Frame(i, c.path, at, span.position))
    return frames


def load_frame(frame: Frame, work: Path) -> Image.Image:
    if frame.source.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
        with Image.open(frame.source) as img:
            return img.convert("RGB")
    out = work / f".full_{frame.number:02d}.png"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", f"{frame.at:.2f}", "-i", str(frame.source),
         "-frames:v", "1", str(out)],
        capture_output=True,
        check=False,
    )  # fmt: skip
    if not out.exists():
        raise FileNotFoundError(frame.source)
    with Image.open(out) as img:
        return img.convert("RGB")


def write_previews(frames: list[Frame], folder: Path) -> list[str]:
    """Cuadros pequeños para que Claude los mire (cuadro_01.jpg…)."""
    folder.mkdir(parents=True, exist_ok=True)
    names = []
    for f in frames:
        try:
            img = load_frame(f, folder)
        except (FileNotFoundError, OSError):
            continue
        img.thumbnail((PREVIEW_W, PREVIEW_W))
        name = f"cuadro_{f.number:02d}.jpg"
        img.save(folder / name, "JPEG", quality=82)
        names.append(name)
    (folder / "cuadros.json").write_text(
        json.dumps(
            [{"n": f.number, "source": str(f.source), "at": f.at, "scene": f.scene} for f in frames]
        ),
        encoding="utf-8",
    )
    return names


def saved_frames(folder: Path) -> dict[int, Frame]:
    path = folder / "cuadros.json"
    if not path.exists():
        return {}
    return {
        d["n"]: Frame(d["n"], Path(d["source"]), d["at"], d["scene"])
        for d in json.loads(path.read_text(encoding="utf-8"))
    }


# --- dibujo ---


def _font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(str(FONT), size)
    except OSError:
        return ImageFont.load_default(size)


def _fit(img: Image.Image, size: tuple[int, int], fx: float, fy: float):
    """Encuadra centrando el foco; devuelve la imagen y la posición del foco en ella."""
    fitted = ImageOps.fit(img, size, Image.Resampling.LANCZOS, centering=(fx, fy))
    # Posición aproximada del foco dentro del recorte (la que calcula ImageOps.fit).
    w, h = img.size
    scale = max(size[0] / w, size[1] / h)
    sw, sh = w * scale, h * scale
    left = (sw - size[0]) * fx
    top = (sh - size[1]) * fy
    return fitted, (fx * sw - left, fy * sh - top)


def _grade(img: Image.Image, template: str) -> Image.Image:
    img = ImageEnhance.Contrast(img).enhance(1.18)
    if template == "expediente":
        gray = ImageOps.grayscale(img)
        img = Image.blend(ImageOps.colorize(gray, (10, 25, 35), (215, 230, 235)), img, 0.25)
    else:
        img = ImageEnhance.Color(img).enhance(0.9)
    return img


def _gradient(
    size: tuple[int, int], start: float, strength: int, vertical: bool = True
) -> Image.Image:
    """Máscara de degradado: transparente hasta `start` y hasta `strength` (0–255) al final."""
    w, h = size
    length = h if vertical else w
    line = Image.new("L", (1, length) if vertical else (length, 1))
    for i in range(length):
        v = max(0.0, (i / length - start) / (1 - start))
        line.putpixel((0, i) if vertical else (i, 0), int(v * strength))
    return line.resize(size)


def _wrap(text: str, font_for, max_w: int, max_lines: int, start: int) -> tuple[list[str], int]:
    """Parte el texto en líneas y achica la fuente hasta que quepa en `max_w`."""
    words = text.split()
    size = start
    while size > 20:
        font = font_for(size)
        lines, current = [], ""
        for word in words:
            test = f"{current} {word}".strip()
            if font.getlength(test) <= max_w or not current:
                current = test
            else:
                lines.append(current)
                current = word
        lines.append(current)
        if len(lines) <= max_lines and all(font.getlength(line) <= max_w for line in lines):
            return lines, size
        size = int(size * 0.92)
    return [text], size


PUNCT = ".,:;!?¿¡«»\"'"


def _same(word: str, highlight: str | None) -> bool:
    """La palabra es la resaltada (sin mayúsculas ni puntuación)."""
    key = (highlight or "").strip(PUNCT + " ").upper()
    return bool(key) and word.strip(PUNCT).upper() == key


def _draw_words(draw, line: str, x: float, y: float, font, fill, accent, highlight, stroke: int):
    """Escribe una línea resaltando la palabra `highlight` en el color de acento."""
    for word in line.split(" "):
        color = accent if _same(word, highlight) else fill
        draw.text((x, y), word, font=font, fill=color, stroke_width=stroke, stroke_fill=(0, 0, 0))
        x += font.getlength(word + " ")


def _badge(draw, text: str, x: int, y: int, size: int, bg, fg=(255, 255, 255)) -> None:
    font = _font(size)
    pad = size // 2
    w = int(font.getlength(text))
    draw.rectangle((x, y, x + w + pad * 2, y + size + pad), fill=bg)
    draw.text((x + pad, y + pad // 2 - size * 0.08), text, font=font, fill=fg)


def _luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = (c / 255 for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _hex(color: str) -> tuple[int, int, int]:
    return tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def render(design: DisenoClaude, frame: Image.Image, size: tuple[int, int]) -> Image.Image:
    w, h = size
    portrait = h > w
    img, (fx, fy) = _fit(frame, size, design.foco_x, design.foco_y)
    img = _grade(img, design.plantilla)
    accent = _hex(design.color)
    text = design.texto.strip().upper()
    draw = ImageDraw.Draw(img)
    margin = int(w * 0.06)

    if design.plantilla == "impacto":
        img = Image.composite(Image.new("RGB", size, (0, 0, 0)), img, _gradient(size, 0.35, 215))
        draw = ImageDraw.Draw(img)
        lines, fs = _wrap(
            text,
            _font,
            int(w * 0.88),
            2 if not portrait else 3,
            int(h * (0.2 if not portrait else 0.1)),
        )
        font = _font(fs)
        line_h = int(fs * 1.02)
        y = h - int(h * 0.08) - line_h * len(lines)
        stroke = max(fs // 11, 3)
        shadow = Image.new("RGBA", size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        for i, line in enumerate(lines):
            sd.text(
                (margin + fs * 0.06, y + i * line_h + fs * 0.08),
                line,
                font=font,
                fill=(0, 0, 0, 200),
            )
        img.paste(
            shadow.filter(ImageFilter.GaussianBlur(fs * 0.06)),
            (0, 0),
            shadow.filter(ImageFilter.GaussianBlur(fs * 0.06)),
        )
        draw = ImageDraw.Draw(img)
        for i, line in enumerate(lines):
            _draw_words(
                draw,
                line,
                margin,
                y + i * line_h,
                font,
                (255, 255, 255),
                accent,
                design.resaltar,
                stroke,
            )
        if design.etiqueta:
            _badge(
                draw,
                design.etiqueta.upper(),
                margin,
                int(h * 0.06),
                int(h * (0.055 if not portrait else 0.028)),
                (229, 57, 53),
            )

    elif design.plantilla == "documental":
        img = Image.composite(Image.new("RGB", size, (8, 8, 10)), img, _gradient(size, 0.5, 235))
        draw = ImageDraw.Draw(img)
        lines, fs = _wrap(text, _font, int(w * 0.84), 2, int(h * (0.13 if not portrait else 0.07)))
        font = _font(fs)
        line_h = int(fs * 1.1)
        y = h - int(h * 0.09) - line_h * len(lines)
        draw.rectangle(
            (
                margin,
                y - int(fs * 0.45),
                margin + int(w * 0.12),
                y - int(fs * 0.45) + max(h // 120, 4),
            ),
            fill=accent,
        )
        if design.etiqueta:
            label = _font(int(fs * 0.34))
            draw.text(
                (margin, y - int(fs * 0.95)), design.etiqueta.upper(), font=label, fill=accent
            )
        for i, line in enumerate(lines):
            _draw_words(
                draw,
                line,
                margin,
                y + i * line_h,
                font,
                (245, 245, 245),
                accent,
                design.resaltar,
                max(fs // 30, 1),
            )

    else:  # expediente
        draw = ImageDraw.Draw(img)
        r = int(min(w, h) * 0.16)
        cx, cy = min(max(fx, r), w - r), min(max(fy, r), h - r)
        for k in range(max(r // 14, 5)):
            draw.ellipse((cx - r - k, cy - r - k, cx + r + k, cy + r + k), outline=(229, 57, 53))
        # Cinta clara (amarillo, blanco): texto oscuro y resaltado en rojo; cinta oscura o
        # roja: texto blanco y resaltado en amarillo (si no, rojo sobre rojo no se ve).
        light = _luminance(accent) > 0.55
        tape_text = (15, 15, 15) if light else (255, 255, 255)
        tape_highlight = (229, 57, 53) if light else (255, 212, 0)
        lines, fs = _wrap(
            text,
            _font,
            int(w * 0.6 if not portrait else w * 0.84),
            3,
            int(h * (0.13 if not portrait else 0.065)),
        )
        font = _font(fs)
        tape = Image.new("RGBA", size, (0, 0, 0, 0))
        td = ImageDraw.Draw(tape)
        # Del lado contrario al foco, para no tapar el círculo.
        left_side = fx > w / 2
        # En vertical, el texto va en la mitad contraria al foco para no tapar el círculo.
        y = int(h * (0.12 if not portrait or fy > h * 0.5 else 0.6))
        for line in lines:
            lw = int(font.getlength(line))
            x = margin if left_side else w - margin - lw - fs // 2
            td.rectangle(
                (x - fs // 4, y, x + lw + fs // 4, y + int(fs * 1.15)), fill=accent + (255,)
            )
            for word_x, word in _positions(line, font, x):
                color = tape_highlight if _same(word, design.resaltar) else tape_text
                td.text((word_x, y + fs * 0.04), word, font=font, fill=color)
            y += int(fs * 1.3)
        tape = tape.rotate(
            -3 if left_side else 3, resample=Image.Resampling.BICUBIC, center=(w / 2, h / 2)
        )
        img.paste(tape, (0, 0), tape)
        draw = ImageDraw.Draw(img)
        if design.etiqueta:
            _badge(
                draw,
                design.etiqueta.upper(),
                margin,
                h - int(h * 0.14),
                int(h * (0.05 if not portrait else 0.026)),
                (15, 15, 15),
                accent,
            )
    return img


def _positions(line: str, font, x: float):
    for word in line.split(" "):
        yield x, word
        x += font.getlength(word + " ")
