"""Alineación de la transcripción (Whisper) con los segmentos del guion (sección 5.9).

Las palabras de Whisper no coinciden exacto con el guion (números, puntuación, una palabra mal
oída), así que se comparan normalizadas con difflib y cada segmento toma el tiempo de sus palabras
emparejadas. Los segmentos sin ninguna coincidencia se interpolan entre sus vecinos.
"""

import difflib
import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class SegmentTiming:
    seg_key: str
    start_s: float
    end_s: float


def normalize(token: str) -> str:
    decomposed = unicodedata.normalize("NFKD", token.lower())
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^\w]", "", plain)


def tokenize(text: str) -> list[str]:
    return [t for t in (normalize(w) for w in text.split()) if t]


def align_segments(segments: list[tuple[str, str]], words: list[Word]) -> list[SegmentTiming]:
    """segments: [(seg_key, texto)] en orden. Devuelve el inicio y fin real de cada segmento."""
    if not segments:
        return []
    script_tokens: list[str] = []
    owner: list[int] = []  # índice del segmento de cada palabra del guion
    for i, (_key, text) in enumerate(segments):
        for token in tokenize(text):
            script_tokens.append(token)
            owner.append(i)
    spoken = [normalize(w.text) for w in words]

    starts: list[float | None] = [None] * len(segments)
    ends: list[float | None] = [None] * len(segments)
    matcher = difflib.SequenceMatcher(a=script_tokens, b=spoken, autojunk=False)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            seg = owner[block.a + k]
            word = words[block.b + k]
            starts[seg] = word.start if starts[seg] is None else min(starts[seg], word.start)
            ends[seg] = word.end if ends[seg] is None else max(ends[seg], word.end)

    total_end = max((w.end for w in words), default=0.0)
    _interpolate(starts, ends, total_end)
    return [
        SegmentTiming(key, round(s, 2), round(max(e, s), 2))
        for (key, _), s, e in zip(segments, starts, ends, strict=True)
    ]


def _interpolate(starts: list[float | None], ends: list[float | None], total_end: float) -> None:
    """Rellena los segmentos sin coincidencias repartiendo el hueco entre sus vecinos conocidos."""
    n = len(starts)
    i = 0
    while i < n:
        if starts[i] is not None:
            i += 1
            continue
        j = i
        while j < n and starts[j] is None:
            j += 1
        gap_start = ends[i - 1] if i > 0 else 0.0
        gap_end = starts[j] if j < n else total_end
        gap_start = gap_start or 0.0
        gap_end = max(gap_end or gap_start, gap_start)
        count = j - i
        step = (gap_end - gap_start) / count
        for k in range(count):
            starts[i + k] = gap_start + step * k
            ends[i + k] = gap_start + step * (k + 1)
        i = j
