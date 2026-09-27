"""Subtítulos SRT y VTT (sección 5.9): por palabras (Whisper) o por segmentos (voz de Piper)."""

from dataclasses import dataclass

from .align import SegmentTiming, Word

MAX_CHARS = 42  # una línea legible en móvil
MAX_WORDS = 8
MAX_SECONDS = 3.5


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


def cues_from_words(words: list[Word]) -> list[Cue]:
    """Agrupa palabras en frases cortas; corta en puntuación fuerte, largo o duración."""
    cues: list[Cue] = []
    current: list[Word] = []

    def flush() -> None:
        if current:
            text = " ".join(w.text.strip() for w in current).strip()
            cues.append(Cue(current[0].start, current[-1].end, text))
            current.clear()

    for word in words:
        if current:
            text = " ".join(w.text.strip() for w in [*current, word])
            if (
                len(text) > MAX_CHARS
                or len(current) >= MAX_WORDS
                or word.end - current[0].start > MAX_SECONDS
            ):
                flush()
        current.append(word)
        if word.text.strip().endswith((".", "?", "!", "…")):
            flush()
    flush()
    return cues


def cues_from_segments(timings: list[SegmentTiming], texts: dict[str, str]) -> list[Cue]:
    """Sin tiempos por palabra (voz de Piper): se estiman y se agrupan en frases cortas, en vez
    de un subtítulo por segmento (que en un reel ocupaba 4 líneas)."""
    return cues_from_words(estimate_words(timings, texts))


def estimate_words(timings: list[SegmentTiming], texts: dict[str, str]) -> list[Word]:
    """Reparte el tiempo de cada segmento entre sus palabras según su largo (más una pausa
    pequeña por palabra). Sirve para la voz de Piper, que solo da el tiempo de cada segmento."""
    words: list[Word] = []
    for t in timings:
        tokens = (texts.get(t.seg_key) or "").split()
        if not tokens or t.end_s <= t.start_s:
            continue
        weights = [len(tok) + 1 for tok in tokens]
        span = t.end_s - t.start_s
        total = sum(weights)
        at = t.start_s
        for tok, weight in zip(tokens, weights, strict=True):
            end = at + span * weight / total
            words.append(Word(tok, round(at, 3), round(end, 3)))
            at = end
    return words


def _clock(seconds: float, sep: str) -> str:
    ms = round(seconds * 1000)
    h, rest = divmod(ms, 3_600_000)
    m, rest = divmod(rest, 60_000)
    s, ms = divmod(rest, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def to_srt(cues: list[Cue]) -> str:
    blocks = [
        f"{i}\n{_clock(c.start, ',')} --> {_clock(c.end, ',')}\n{c.text}\n"
        for i, c in enumerate(cues, start=1)
    ]
    return "\n".join(blocks)


def to_vtt(cues: list[Cue]) -> str:
    blocks = [f"{_clock(c.start, '.')} --> {_clock(c.end, '.')}\n{c.text}\n" for c in cues]
    return "WEBVTT\n\n" + "\n".join(blocks)
