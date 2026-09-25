"""Motores locales: Piper (texto → voz) y faster-whisper (voz → palabras con tiempos).

Las fábricas se reemplazan en los tests para no cargar modelos reales.
"""

import wave
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from .align import Word


class Synthesizer(Protocol):
    def synthesize(self, text: str, out_path: Path, speed: float) -> None: ...


class Transcriber(Protocol):
    def transcribe(self, audio: Path, language: str) -> list[Word]: ...


class PiperSynthesizer:
    def __init__(self, model_path: Path):
        from piper import PiperVoice

        self.voice = PiperVoice.load(str(model_path))

    def synthesize(self, text: str, out_path: Path, speed: float) -> None:
        from piper import SynthesisConfig

        out_path.parent.mkdir(parents=True, exist_ok=True)
        # length_scale > 1 habla más lento: es la inversa de la velocidad.
        config = SynthesisConfig(length_scale=1 / speed)
        with wave.open(str(out_path), "wb") as wf:
            self.voice.synthesize_wav(text, wf, syn_config=config)


class WhisperTranscriber:
    def __init__(self, model_dir: Path):
        from faster_whisper import WhisperModel

        self.model = WhisperModel(str(model_dir), device="cpu", compute_type="int8")

    def transcribe(self, audio: Path, language: str) -> list[Word]:
        segments, _info = self.model.transcribe(
            str(audio), language=language or None, word_timestamps=True, vad_filter=True
        )
        return [Word(w.word, w.start, w.end) for s in segments for w in (s.words or [])]


@lru_cache(maxsize=2)
def _piper(model_path: str) -> PiperSynthesizer:
    return PiperSynthesizer(Path(model_path))


@lru_cache(maxsize=1)
def _whisper(model_dir: str) -> WhisperTranscriber:
    return WhisperTranscriber(Path(model_dir))


synthesizer_factory: Callable[[Path], Synthesizer] = lambda p: _piper(str(p))  # noqa: E731
transcriber_factory: Callable[[Path], Transcriber] = lambda p: _whisper(str(p))  # noqa: E731
