"""Subtítulos quemados con estilo (ASS para libass): frases cortas, mayúsculas, colores y la
palabra que se está diciendo resaltada (estilo karaoke de reels y shorts).

Las palabras llegan con sus tiempos (exactos de ElevenLabs/Whisper o estimados para Piper) y
se agrupan en frases de pocas palabras. Con el resaltado activo, cada frase se escribe como una
serie de eventos: uno por palabra, con esa palabra en el color de resaltado.
"""

import re

from ...config import SubtitleStyle
from ..voice.align import Word

FONTS = ("Arial", "Impact", "Verdana", "Segoe UI")

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


def build_ass(words: list[Word], style: SubtitleStyle, width: int, height: int) -> str:
    portrait = height > width
    per_line = style.words_per_line or (3 if portrait else 6)
    max_chars = 22 if portrait else 42
    base = (width * 0.078) if portrait else (height * 0.062)
    size = round(base * SIZE_FACTOR[style.size])
    outline = max(round(size * 0.09), 2)
    if style.position == "middle":
        alignment, margin_v = 5, 0
    else:  # tercio inferior, por encima de los botones de Reels/Shorts
        alignment, margin_v = 2, round(height * (0.22 if portrait else 0.08))
    border_style = 3 if style.background else 1
    back = ass_color("#000000", alpha=0x60) if style.background else ass_color("#000000", 0x80)

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
            f"Style: Default,{style.font},{size},{text_c},{text_c},{edge_c},"
            f"{back},-1,0,0,0,100,100,0,0,{border_style},{outline},0,{alignment},"
            f"{round(width * 0.06)},{round(width * 0.06)},{margin_v},1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )

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
        texts = [shown(w) for w in group]
        if not style.highlight:
            events.append(
                f"Dialogue: 0,{_clock(start)},{_clock(end)},Default,,0,0,0,,{' '.join(texts)}"
            )
            continue
        for j, _word in enumerate(group):
            w_start = start if j == 0 else group[j].start
            w_end = group[j + 1].start if j + 1 < len(group) else end
            if w_end <= w_start:
                continue
            line = " ".join(
                f"{{\\1c{high_c}}}{t}{{\\1c{text_c}}}" if k == j else t for k, t in enumerate(texts)
            )
            events.append(f"Dialogue: 0,{_clock(w_start)},{_clock(w_end)},Default,,0,0,0,,{line}")
    return header + "\n" + "\n".join(events) + "\n"
