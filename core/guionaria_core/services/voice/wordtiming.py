"""Tiempos por palabra para la voz de Piper (que solo da el tiempo de cada segmento).

En vez de repartir el segmento por caracteres, se mira el audio:
1. Dónde empieza y termina realmente la voz (se quitan los silencios de los bordes).
2. Qué pausas hay dentro (silencios de más de 0,1 s) y se emparejan con la puntuación
   del texto (comas, puntos…), que es donde Piper hace las pausas.
3. Dentro de cada frase se reparte según el largo *hablado* de cada palabra: los números se
   leen enteros («1971» → «mil novecientos setenta y uno») y pesan mucho más que sus cifras.

Sin dependencias: se lee el WAV con `wave` y se calcula la energía por ventanas de 10 ms.
"""

import math
import wave
from array import array
from pathlib import Path

from .align import Word

FRAME_S = 0.01
MIN_SILENCE_S = 0.1
SILENCE_DB = -38.0  # respecto al máximo del segmento
PUNCT = (",", ".", ";", ":", "?", "!", "…", "—")
DIGIT_WEIGHT = 6.5  # caracteres hablados por cifra (promedio en español)


def spoken_weight(token: str) -> float:
    letters = sum(c.isalpha() for c in token)
    digits = sum(c.isdigit() for c in token)
    return letters + digits * DIGIT_WEIGHT + 1


def _energy(path: Path) -> tuple[list[float], float]:
    """Energía (RMS) por ventana de 10 ms y duración del archivo."""
    with wave.open(str(path)) as wf:
        rate, channels, width = wf.getframerate(), wf.getnchannels(), wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())
        duration = wf.getnframes() / rate
    if width != 2:
        raise ValueError("Solo WAV de 16 bits")
    samples = array("h", raw)
    if channels > 1:
        samples = samples[::channels]
    step = max(int(rate * FRAME_S), 1)
    stride = 4  # basta una muestra de cada cuatro para la energía
    out = []
    for i in range(0, len(samples), step):
        chunk = samples[i : i + step : stride]
        if chunk:
            out.append(math.sqrt(sum(x * x for x in chunk) / len(chunk)))
    return out, duration


def voice_regions(path: Path) -> tuple[float, float, list[tuple[float, float]]]:
    """(inicio de la voz, fin de la voz, silencios internos) en segundos dentro del archivo."""
    energy, duration = _energy(path)
    peak = max(energy, default=0)
    if peak <= 0:
        return 0.0, duration, []
    threshold = peak * 10 ** (SILENCE_DB / 20)
    voiced = [e > threshold for e in energy]
    if not any(voiced):
        return 0.0, duration, []
    first = voiced.index(True)
    last = len(voiced) - 1 - voiced[::-1].index(True)
    silences = []
    run_start = None
    for i in range(first, last + 1):
        if not voiced[i]:
            run_start = i if run_start is None else run_start
        elif run_start is not None:
            if (i - run_start) * FRAME_S >= MIN_SILENCE_S:
                silences.append((run_start * FRAME_S, i * FRAME_S))
            run_start = None
    return first * FRAME_S, min((last + 1) * FRAME_S, duration), silences


def _distribute(tokens: list[str], start: float, end: float) -> list[Word]:
    weights = [spoken_weight(t) for t in tokens]
    total = sum(weights) or 1
    words, at = [], start
    for token, weight in zip(tokens, weights, strict=True):
        nxt = at + (end - start) * weight / total
        words.append(Word(token, round(at, 3), round(nxt, 3)))
        at = nxt
    return words


def segment_words(text: str, wav: Path, offset: float) -> list[Word]:
    """Palabras del segmento con tiempos absolutos (offset = inicio del segmento en la voz)."""
    tokens = text.split()
    if not tokens:
        return []
    begin, finish, silences = voice_regions(wav)
    # Frases separadas por puntuación: ahí es donde Piper hace pausas.
    phrases: list[list[str]] = [[]]
    for i, token in enumerate(tokens):
        phrases[-1].append(token)
        if token.endswith(PUNCT) and i < len(tokens) - 1:
            phrases.append([])
    phrases = [p for p in phrases if p]

    # Límites estimados entre frases y el silencio real más cercano a cada uno.
    weights = [sum(spoken_weight(t) for t in p) for p in phrases]
    total = sum(weights) or 1
    spoken = sum(e - s for s, e in silences)
    span = max(finish - begin - spoken, 0.01)
    bounds: list[tuple[float, float]] = []  # (fin de la frase, inicio de la siguiente)
    acc, used = begin, set()
    for w in weights[:-1]:
        acc += span * w / total
        best = None
        for idx, (s, e) in enumerate(silences):
            if idx in used:
                continue
            distance = abs((s + e) / 2 - acc)
            if distance < 0.8 and (best is None or distance < best[0]):
                best = (distance, idx)
        if best:
            used.add(best[1])
            s, e = silences[best[1]]
            bounds.append((s, e))
            acc = e  # a partir del silencio real
        else:
            bounds.append((acc, acc))
    # Los límites deben quedar en orden aunque dos frases se emparejen raro.
    words: list[Word] = []
    start = begin
    for i, phrase in enumerate(phrases):
        end = bounds[i][0] if i < len(bounds) else finish
        end = max(end, start + 0.05 * len(phrase))
        words += _distribute(phrase, start, end)
        start = bounds[i][1] if i < len(bounds) else end
    return [Word(w.text, round(w.start + offset, 3), round(w.end + offset, 3)) for w in words]


def piper_words(
    segments: list[tuple[str, str]],
    timings: dict[str, tuple[float, float]],
    files: dict[str, Path],
) -> list[Word]:
    """Palabras de toda la voz de Piper: cada segmento desde su propio WAV."""
    from .align import SegmentTiming
    from .subtitles import estimate_words

    words: list[Word] = []
    for seg_key, text in segments:
        if seg_key not in timings:
            continue
        start, end = timings[seg_key]
        path = files.get(seg_key)
        try:
            if path is None or not path.exists():
                raise FileNotFoundError(seg_key)
            words += segment_words(text, path, start)
        except (OSError, ValueError, EOFError, wave.Error):
            # Sin su WAV: reparto simple dentro del segmento.
            words += estimate_words([SegmentTiming(seg_key, start, end)], {seg_key: text})
    return words
