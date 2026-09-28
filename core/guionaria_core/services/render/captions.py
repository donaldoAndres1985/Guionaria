"""Subtítulos quemados con estilo (ASS para libass): frases cortas, mayúsculas, colores y la
palabra que se está diciendo resaltada (estilo karaoke de reels y shorts).

Las palabras llegan con sus tiempos (exactos de ElevenLabs/Whisper o estimados para Piper) y
se agrupan en frases de pocas palabras. Con el resaltado activo, cada frase se escribe como una
serie de eventos: uno por palabra, con esa palabra en el color de resaltado.

El texto en pantalla de las escenas va en el mismo archivo, con su estilo y su animación de
entrada: libass lo parte en líneas dentro de los márgenes, igual que la vista previa.
"""

import re
from dataclasses import dataclass
from pathlib import Path

from ...config import SubtitleStyle, TextStyle
from ..voice.align import Word

FONTS = ("Arial", "Montserrat", "Impact", "Verdana", "Segoe UI")
# Fuentes incluidas con la app (licencia OFL): no dependen de lo instalado en Windows.
FONTS_DIR = Path(__file__).resolve().parent.parent.parent / "assets" / "fonts"
# Nombre de familia dentro del archivo y si hay que pedir negrita (las incluidas ya lo son).
FONT_FACE = {"Montserrat": ("Montserrat ExtraBold", 0)}
POP_SCALE = 118  # % al aparecer la palabra con la animación «pop»
POP_MS = 140
# libass ajusta la fuente a su altura de línea (ascendente + descendente de Windows), no al
# «em» como el navegador: con el mismo número, Montserrat sale al 62 % del tamaño. Se
# multiplica por esta escala (medida con libass) para que el render coincida con la vista
# previa, que usa px de CSS.
ASS_FONT_SCALE = {
    "Montserrat": 1.61,
    "Arial": 1.15,
    "Impact": 1.25,
    "Verdana": 1.25,
    "Segoe UI": 1.38,
}


def ass_size(font: str, css_px: float) -> int:
    return round(css_px * ASS_FONT_SCALE.get(font, 1.0))


SIZE_FACTOR = {"small": 0.8, "medium": 1.0, "large": 1.25}
STRONG_PAUSE = (".", "?", "!", "…", ":", ";")
GAP_JOIN_S = 0.35  # huecos más cortos se cubren para que el subtítulo no parpadee


def ass_color(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB → &HAABBGGRR (formato ASS)."""
    r, g, b = hex_color[1:3], hex_color[3:5], hex_color[5:7]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _clock(seconds: float) -> str:
    cs = max(round(seconds * 100), 0)
    h, rest = divmod(cs, 360000)
    m, rest = divmod(rest, 6000)
    s, cs = divmod(rest, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _clean(text: str) -> str:
    # Llaves y barras invertidas son sintaxis de ASS.
    return re.sub(r"[{}\\]", "", text).strip()


def group_words(words: list[Word], per_line: int, max_chars: int) -> list[list[Word]]:
    """Frases cortas: como mucho `per_line` palabras o `max_chars` caracteres, y corte tras
    puntuación fuerte o una pausa larga."""
    groups: list[list[Word]] = []
    current: list[Word] = []
    for word in words:
        if current:
            text = " ".join(w.text for w in [*current, word])
            pause = word.start - current[-1].end > 0.6
            if len(current) >= per_line or len(text) > max_chars or pause:
                groups.append(current)
                current = []
        current.append(word)
        if word.text.rstrip().endswith(STRONG_PAUSE):
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


@dataclass
class SceneText:
    """Texto en pantalla de una escena, en segundos del video final."""

    start: float
    end: float
    text: str
    centered: bool  # escenas sin medio (texto sobre negro): centrado y más grande


SUBTITLE_MARGIN = 0.04  # margen lateral de los subtítulos (como la vista previa)
TEXT_MARGIN = 0.05  # margen lateral (fracción del ancho), el mismo de la vista previa
TEXT_SIZE_FACTOR = {"small": 0.8, "medium": 1.0, "large": 1.2}
TYPEWRITER_STEPS = 30


SEPARATORS = re.compile(r"\s+[·|•–—]\s+")


def line_chars(width: int, size: int) -> int:
    """Caracteres que caben en una línea (aprox.: el ancho medio de un carácter en negrita es
    ~0,56 del tamaño de la fuente)."""
    return max(10, round(width * (1 - 2 * TEXT_MARGIN) / (0.56 * size)))


def layout_text(text: str, limit: int) -> str:
    """Líneas del texto en pantalla. Una línea larga con separadores («Nombre · 50 años ·
    socióloga») se corta en ellos, juntando las partes que caben; el resto lo parte libass
    (o el navegador en la vista previa) por el ancho. Igual que layoutText en la app."""
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        parts = SEPARATORS.split(line)
        if len(line) <= limit or len(parts) == 1:
            out.append(line)
            continue
        seps = SEPARATORS.findall(line)
        current = parts[0]
        for sep, part in zip(seps, parts[1:], strict=True):
            if len(current) + len(sep) + len(part) <= limit:
                current += sep + part
            else:
                out.append(current)
                current = part
        out.append(current)
    return "\n".join(x for x in out if x)


def scene_text_size(width: int, height: int, centered: bool, size: str = "medium") -> int:
    """Tamaño del texto en pantalla (la vista previa usa el mismo número en píxeles)."""
    base = height / (11 if centered else 16) if height < width else width / (11 if centered else 13)
    return round(base * TEXT_SIZE_FACTOR[size])


def text_y(height: int, centered: bool, raised: bool) -> int:
    """Centro vertical del texto: arriba si hay subtítulos quemados, para no taparse."""
    if centered:  # con subtítulos, un poco más arriba para no pisarlos
        return round(height * (0.42 if raised else 0.5))
    return round(height * (0.16 if raised else 0.78))


def _text_style_line(name: str, style: TextStyle, size: int, width: int) -> str:
    face, bold = FONT_FACE.get(style.font, (style.font, -1))
    color = ass_color(style.text_color)
    if style.box:  # caja opaca: libass la pinta con el color del borde
        edge, border_style, outline, shadow = ass_color("#000000", 0x55), 3, round(size * 0.2), 0
    else:
        edge, border_style = ass_color("#000000"), 1
        outline, shadow = max(size // 12, 2), max(round(size * 0.04), 1)
    margin = round(width * TEXT_MARGIN)
    return (
        f"Style: {name},{face},{ass_size(style.font, size)},{color},{color},{edge},"
        f"{ass_color('#000000', 0x80)},"
        f"{bold},0,0,0,100,100,0,0,{border_style},{outline},{shadow},5,{margin},{margin},0,1"
    )


def _text_events(
    item: SceneText, style: TextStyle, width: int, height: int, raised: bool
) -> list[str]:
    name = "TextCenter" if item.centered else "Text"
    size = scene_text_size(width, height, item.centered, style.size)
    laid = layout_text(item.text, line_chars(width, size))
    lines = [_clean(line) for line in laid.splitlines()]
    lines = [(line.upper() if style.uppercase else line) for line in lines if line]
    if not lines or item.end <= item.start:
        return []
    text = r"\N".join(lines)
    x, y = width // 2, text_y(height, item.centered, raised)
    pos = rf"\pos({x},{y})"
    out_ms = min(150, round((item.end - item.start) * 250))

    def event(a: float, b: float, tags: str, body: str) -> str:
        return f"Dialogue: 1,{_clock(a)},{_clock(b)},{name},,0,0,0,,{{{tags}}}{body}"

    if style.animation == "typewriter":
        # Letra a letra: lo que falta se dibuja transparente, así las líneas no se mueven.
        reveal = min(1.2, max(0.4, (item.end - item.start) * 0.4))
        plain = "\n".join(lines)
        steps = min(TYPEWRITER_STEPS, len(plain))
        events = []
        for k in range(1, steps):
            cut = round(len(plain) * k / steps)
            shown, rest = (part.replace("\n", r"\N") for part in (plain[:cut], plain[cut:]))
            a = item.start + reveal * (k - 1) / steps
            b = item.start + reveal * k / steps
            events.append(event(a, b, pos, shown + r"{\alpha&HFF&}" + rest))
        a = item.start + reveal * max(steps - 1, 0) / steps
        events.append(event(a, item.end, rf"{pos}\fad(0,{out_ms})", text))
        return events
    if style.animation == "pop":
        tags = (
            rf"{pos}\fscx60\fscy60\t(0,150,\fscx108\fscy108)"
            rf"\t(150,260,\fscx100\fscy100)\fad(90,{out_ms})"
        )
    elif style.animation == "slide":
        rise = round(height * 0.03)
        tags = rf"\move({x},{y + rise},{x},{y},0,300)\fad(220,{out_ms})"
    elif style.animation == "fade":
        tags = rf"{pos}\fad(300,{out_ms})"
    else:
        tags = pos
    return [event(item.start, item.end, tags, text)]


def build_ass(
    words: list[Word],
    style: SubtitleStyle,
    width: int,
    height: int,
    texts: list[SceneText] | None = None,
    text_style: TextStyle | None = None,
    raised: bool | None = None,
) -> str:
    """ASS con los subtítulos (si hay palabras) y el texto en pantalla de las escenas.
    `raised`: el texto de escena sube arriba; por defecto, cuando hay subtítulos."""
    text_style = text_style or TextStyle()
    raised = bool(words) if raised is None else raised
    portrait = height > width
    per_line = style.words_per_line or (3 if portrait else 6)
    max_chars = 18 if portrait else 42  # una sola línea legible en vertical
    base = (width * 0.078) if portrait else (height * 0.062)
    size = round(base * SIZE_FACTOR[style.size])
    outline = max(round(size * 0.09), 2)
    shadow = 0
    blur = 0
    if style.edge == "shadow":  # estilo reel: borde fino y sombra suave desenfocada
        outline, shadow, blur = max(round(size * 0.02), 1), max(round(size * 0.07), 2), 3
    elif style.edge == "both":
        shadow = max(round(size * 0.06), 2)
    if style.position == "middle":
        alignment, margin_v = 5, 0
    else:  # tercio inferior, por encima de los botones de Reels/Shorts
        alignment, margin_v = 2, round(height * (0.22 if portrait else 0.08))
    border_style = 3 if style.background else 1
    back = ass_color("#000000", alpha=0x60) if style.background else ass_color("#000000", 0x70)
    face, bold = FONT_FACE.get(style.font, (style.font, -1))
    italic = -1 if style.italic else 0

    text_c = ass_color(style.text_color)
    high_c = ass_color(style.highlight_color)
    edge_c = ass_color(style.outline_color)
    header = "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {width}",
            f"PlayResY: {height}",
            "WrapStyle: 0",
            "ScaledBorderAndShadow: yes",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
            "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
            "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Default,{face},{ass_size(style.font, size)},{text_c},{text_c},{edge_c},"
            f"{back},{bold},{italic},0,0,100,100,0,0,{border_style},{outline},{shadow},{alignment},"
            f"{round(width * SUBTITLE_MARGIN)},{round(width * SUBTITLE_MARGIN)},{margin_v},1",
            _text_style_line(
                "Text", text_style, scene_text_size(width, height, False, text_style.size), width
            ),
            _text_style_line(
                "TextCenter",
                text_style,
                scene_text_size(width, height, True, text_style.size),
                width,
            ),
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )

    prefix = f"{{\\blur{blur}}}" if blur and not style.background else ""

    def active(text: str) -> str:
        color = f"\\1c{high_c}" if style.highlight else ""
        if style.animation == "pop":
            tags = f"{color}\\fscx{POP_SCALE}\\fscy{POP_SCALE}\\t(0,{POP_MS},\\fscx100\\fscy100)"
            return f"{{{tags}}}{text}{{\\1c{text_c}\\fscx100\\fscy100}}"
        return f"{{{color}}}{text}{{\\1c{text_c}}}"

    def shown(w: Word) -> str:
        text = _clean(w.text)
        return text.upper() if style.uppercase else text

    events: list[str] = []
    groups = group_words([w for w in words if _clean(w.text)], per_line, max_chars)
    for i, group in enumerate(groups):
        start = group[0].start
        end = group[-1].end
        if i + 1 < len(groups) and groups[i + 1][0].start - end < GAP_JOIN_S:
            end = groups[i + 1][0].start
        shown_words = [shown(w) for w in group]
        if not style.highlight and style.animation == "none":
            events.append(
                f"Dialogue: 0,{_clock(start)},{_clock(end)},Default,,0,0,0,,"
                f"{prefix}{' '.join(shown_words)}"
            )
            continue
        for j, _word in enumerate(group):
            w_start = start if j == 0 else group[j].start
            w_end = group[j + 1].start if j + 1 < len(group) else end
            if w_end <= w_start:
                continue
            line = " ".join(active(t) if k == j else t for k, t in enumerate(shown_words))
            events.append(
                f"Dialogue: 0,{_clock(w_start)},{_clock(w_end)},Default,,0,0,0,,{prefix}{line}"
            )
    for item in texts or []:
        events += _text_events(item, text_style, width, height, raised)
    return header + "\n" + "\n".join(events) + "\n"
