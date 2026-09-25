from guionaria_core.services.voice.align import SegmentTiming, Word, align_segments, normalize
from guionaria_core.services.voice.subtitles import (
    cues_from_segments,
    cues_from_words,
    to_srt,
    to_vtt,
)


def words(*items):
    return [Word(t, s, e) for t, s, e in items]


SEGMENTS = [
    ("seg_001", "Esto no es una película."),
    ("seg_002", "Esto le pasó a una familia real en Ciudad de México."),
]
# Transcripción real de Whisper sobre la voz de Piper (prueba manual de la entrega 2B).
WHISPER = words(
    (" Esto", 0.0, 0.38),
    (" no", 0.38, 0.6),
    (" es", 0.6, 0.88),
    (" una", 0.88, 1.12),
    (" película,", 1.12, 1.72),
    (" esto", 2.34, 2.6),
    (" le", 2.6, 2.78),
    (" pasó", 2.78, 3.16),
    (" a", 3.16, 3.32),
    (" una", 3.32, 3.5),
    (" familia", 3.5, 4.0),
    (" real", 4.0, 4.44),
    (" en", 4.44, 4.68),
    (" Ciudad", 4.68, 5.22),
    (" de", 5.22, 5.44),
    (" México.", 5.44, 5.84),
)


def test_normalize_ignores_case_accents_and_punctuation():
    assert normalize("¿México?") == "mexico"
    assert normalize("película,") == "pelicula"
    assert normalize("—") == ""


def test_align_real_whisper_output():
    assert align_segments(SEGMENTS, WHISPER) == [
        SegmentTiming("seg_001", 0.0, 1.72),
        SegmentTiming("seg_002", 2.34, 5.84),
    ]


def test_align_tolerates_misheard_and_extra_words():
    heard = words(
        (" Esto", 0, 0.4),
        (" no", 0.4, 0.6),
        (" es", 0.6, 0.9),
        (" un", 0.9, 1.1),  # «una» mal oída
        (" película", 1.1, 1.7),
        (" eh", 1.8, 2.0),  # muletilla que no está en el guion
        (" esto", 2.3, 2.6),
        (" le", 2.6, 2.8),
        (" pasó", 2.8, 3.1),
        (" a", 3.1, 3.3),
        (" una", 3.3, 3.5),
        (" familia", 3.5, 4.0),
        (" real", 4.0, 4.4),
        (" en", 4.4, 4.7),
        (" CDMX", 4.7, 5.5),  # distinto del guion
    )
    [s1, s2] = align_segments(SEGMENTS, heard)
    assert (s1.start_s, s1.end_s) == (0.0, 1.7)
    assert (s2.start_s, s2.end_s) == (2.3, 4.7)


def test_segment_without_matches_is_interpolated():
    segments = [("a", "uno dos"), ("b", "palabras que nunca se dijeron"), ("c", "tres cuatro")]
    heard = words(("uno", 0, 0.5), ("dos", 0.5, 1.0), ("tres", 3.0, 3.5), ("cuatro", 3.5, 4.0))
    assert align_segments(segments, heard) == [
        SegmentTiming("a", 0.0, 1.0),
        SegmentTiming("b", 1.0, 3.0),
        SegmentTiming("c", 3.0, 4.0),
    ]


def test_trailing_and_leading_gaps():
    segments = [("a", "nada"), ("b", "hola"), ("c", "tampoco")]
    heard = words(("hola", 2.0, 2.5), ("otra", 2.5, 4.0))
    assert align_segments(segments, heard) == [
        SegmentTiming("a", 0.0, 2.0),
        SegmentTiming("b", 2.0, 2.5),
        SegmentTiming("c", 2.5, 4.0),
    ]


def test_empty_inputs():
    assert align_segments([], WHISPER) == []
    assert align_segments([("a", "hola")], []) == [SegmentTiming("a", 0.0, 0.0)]


def test_cues_from_words_split_on_punctuation_and_length():
    cues = cues_from_words(WHISPER)
    # Corta a las 8 palabras: no deja la preposición «a» colgando al final de la línea.
    assert [c.text for c in cues] == [
        "Esto no es una película, esto le pasó",
        "a una familia real en Ciudad de México.",
    ]
    assert (cues[0].start, cues[-1].end) == (0.0, 5.84)
    for c in cues:
        assert len(c.text) <= 42


def test_cues_break_on_sentence_end():
    cues = cues_from_words(words(("Hola.", 0, 0.5), ("Adiós", 0.6, 1.0)))
    assert [c.text for c in cues] == ["Hola.", "Adiós"]


def test_srt_and_vtt_format():
    cues = cues_from_segments(
        [SegmentTiming("a", 0.0, 1.72), SegmentTiming("b", 62.5, 65.004)],
        {"a": "Esto no es una película.", "b": "Segundo."},
    )
    assert to_srt(cues) == (
        "1\n00:00:00,000 --> 00:00:01,720\nEsto no es una película.\n\n"
        "2\n00:01:02,500 --> 00:01:05,004\nSegundo.\n"
    )
    assert to_vtt(cues).startswith(
        "WEBVTT\n\n00:00:00.000 --> 00:00:01.720\nEsto no es una película.\n"
    )
