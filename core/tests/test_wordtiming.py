"""Tiempos por palabra de Piper a partir del audio (silencios y puntuación)."""

import math
import wave

import pytest

from guionaria_core.services.voice.wordtiming import (
    piper_words,
    segment_words,
    spoken_weight,
    voice_regions,
)

RATE = 16000


def make_wav(path, parts):
    """parts: [(segundos, sonido?)] → tono de 220 Hz o silencio."""
    frames = bytearray()
    t = 0
    for seconds, loud in parts:
        for _ in range(int(RATE * seconds)):
            v = int(9000 * math.sin(2 * math.pi * 220 * t / RATE)) if loud else 0
            frames += int(v).to_bytes(2, "little", signed=True)
            t += 1
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes(bytes(frames))
    return path


def test_numbers_weigh_as_spoken():
    assert spoken_weight("1971.") > spoken_weight("noviembre")
    assert spoken_weight("de") == 3


def test_voice_regions_find_edges_and_pauses(tmp_path):
    wav = make_wav(
        tmp_path / "a.wav", [(0.2, False), (0.8, True), (0.3, False), (0.5, True), (0.4, False)]
    )
    start, end, silences = voice_regions(wav)
    assert start == pytest.approx(0.2, abs=0.02)
    assert end == pytest.approx(1.8, abs=0.02)
    assert len(silences) == 1
    assert silences[0][0] == pytest.approx(1.0, abs=0.02)
    assert silences[0][1] == pytest.approx(1.3, abs=0.02)


def test_words_follow_the_real_pause(tmp_path):
    # «Hola mundo,» suena de 0,2 a 1,0; pausa; «adiós.» de 1,3 a 1,8.
    wav = make_wav(
        tmp_path / "b.wav", [(0.2, False), (0.8, True), (0.3, False), (0.5, True), (0.4, False)]
    )
    words = segment_words("Hola mundo, adiós.", wav, offset=10.0)
    assert [w.text for w in words] == ["Hola", "mundo,", "adiós."]
    assert words[0].start == pytest.approx(10.2, abs=0.03)
    assert words[1].end == pytest.approx(11.0, abs=0.03)  # termina donde empieza la pausa
    assert words[2].start == pytest.approx(11.3, abs=0.03)  # empieza tras la pausa
    assert words[2].end == pytest.approx(11.8, abs=0.03)  # sin el silencio final


def test_missing_wav_falls_back_to_simple_estimate(tmp_path):
    words = piper_words(
        [("seg_001", "Uno dos")], {"seg_001": (0.0, 1.0)}, {"seg_001": tmp_path / "no.wav"}
    )
    assert [w.text for w in words] == ["Uno", "dos"]
    assert words[-1].end == pytest.approx(1.0)
