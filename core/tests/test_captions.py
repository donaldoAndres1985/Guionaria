"""Subtítulos con estilo: frases cortas, mayúsculas, colores y resaltado de la palabra dicha."""

import shutil
import subprocess

import pytest

from guionaria_core.config import SubtitleStyle, TextStyle
from guionaria_core.services.render import captions, plan
from guionaria_core.services.voice.align import SegmentTiming, Word
from guionaria_core.services.voice.subtitles import cues_from_segments, estimate_words

WORDS = [
    Word("Se", 0.0, 0.2),
    Word("lanzó", 0.2, 0.6),
    Word("del", 0.6, 0.8),
    Word("avión", 0.8, 1.2),
    Word("en", 1.2, 1.3),
    Word("paracaídas.", 1.3, 2.0),
    Word("Nunca", 2.4, 2.8),
]


def events(ass: str) -> list[str]:
    return [line for line in ass.splitlines() if line.startswith("Dialogue:")]


def test_ass_colors():
    assert captions.ass_color("#FFD400") == "&H0000D4FF"
    assert captions.ass_color("#000000", alpha=0x60) == "&H60000000"


def test_short_groups_cut_at_punctuation_and_length():
    groups = captions.group_words(WORDS, per_line=3, max_chars=22)
    assert [[w.text for w in g] for g in groups] == [
        ["Se", "lanzó", "del"],
        ["avión", "en", "paracaídas."],  # corta tras el punto
        ["Nunca"],
    ]


def test_highlight_one_event_per_word_in_uppercase():
    style = SubtitleStyle(uppercase=True, highlight=True, highlight_color="#FFD400")
    ass = captions.build_ass(WORDS, style, 1080, 1920)
    lines = events(ass)
    assert len(lines) == len(WORDS)  # una por palabra
    yellow, white = "&H0000D4FF", "&H00FFFFFF"
    assert lines[1].endswith(f"SE {{\\1c{yellow}}}LANZÓ{{\\1c{white}}} DEL")
    assert lines[0].startswith("Dialogue: 0,0:00:00.00,0:00:00.20")
    # El último de la frase dura hasta que empieza la siguiente si el hueco es corto.
    assert lines[2].split(",")[2] == "0:00:00.80"
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass


def test_plain_style_lowercase_without_highlight_and_with_box():
    style = SubtitleStyle(
        uppercase=False, highlight=False, background=True, words_per_line=6, text_color="#FFD400"
    )
    ass = captions.build_ass(WORDS, style, 1920, 1080)
    lines = events(ass)
    assert lines[0].endswith(",Se lanzó del avión en paracaídas.")
    assert len(lines) == 2
    style_line = next(line for line in ass.splitlines() if line.startswith("Style: Default"))
    fields = style_line.split(",")
    assert fields[3] == "&H0000D4FF"  # color del texto
    assert fields[15] == "3"  # BorderStyle 3 = caja


def test_position_and_size():
    bottom = captions.build_ass(WORDS, SubtitleStyle(), 1080, 1920)
    fields = next(x for x in bottom.splitlines() if x.startswith("Style:")).split(",")
    assert (fields[18], fields[21]) == ("2", str(round(1920 * 0.22)))  # tercio inferior
    # El tamaño de la vista previa (px de CSS), con la escala de libass para Arial.
    assert fields[2] == str(round(round(1080 * 0.078) * 1.15))
    middle = captions.build_ass(WORDS, SubtitleStyle(position="middle", size="large"), 1080, 1920)
    fields = next(x for x in middle.splitlines() if x.startswith("Style:")).split(",")
    assert fields[18] == "5"
    assert fields[2] == str(round(round(1080 * 0.078 * 1.25) * 1.15))


def test_ass_syntax_is_escaped():
    ass = captions.build_ass([Word("{hola}\\", 0, 1)], SubtitleStyle(highlight=False), 1080, 1920)
    assert events(ass)[0].endswith(",HOLA")


def test_piper_words_are_estimated_and_cues_are_short():
    timings = [SegmentTiming("seg_001", 0.0, 4.0)]
    text = "Un hombre secuestró un avión, cobró el rescate y saltó al vacío. Nadie sabe quién era."
    words = estimate_words(timings, {"seg_001": text})
    assert len(words) == len(text.split())
    assert words[0].start == 0.0 and words[-1].end == pytest.approx(4.0)
    assert all(a.end == pytest.approx(b.start) for a, b in zip(words, words[1:], strict=False))
    # Antes era un único subtítulo con todo el segmento.
    cues = cues_from_segments(timings, {"seg_001": text})
    assert len(cues) >= 2
    assert all(len(c.text) <= 42 for c in cues)


def test_on_screen_text_moves_up_when_subtitles_are_burned(tmp_path):
    q = plan.quality(1080, 1920, "standard")
    assert "h*0.78" in plan.text_filter(tmp_path / "t.txt", None, q, centered=False)
    assert "h*0.16" in plan.text_filter(tmp_path / "t.txt", None, q, centered=False, raised=True)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="requiere FFmpeg")
def test_libass_renders_the_generated_file(tmp_path):
    (tmp_path / "subs.ass").write_text(
        captions.build_ass(WORDS, SubtitleStyle(), 360, 640), encoding="utf-8"
    )
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=gray:s=360x640:d=2.5",
            "-vf",
            "ass=subs.ass",
            "-frames:v",
            "20",
            "out.mp4",
        ],
        cwd=tmp_path,
        capture_output=True,
    )
    assert proc.returncode == 0, proc.stderr.decode(errors="replace")
    assert (tmp_path / "out.mp4").stat().st_size > 0


def test_reel_style_italic_shadow_and_pop():
    style = SubtitleStyle(font="Montserrat", italic=True, edge="shadow", animation="pop")
    ass = captions.build_ass(WORDS, style, 1080, 1920)
    fields = next(x for x in ass.splitlines() if x.startswith("Style:")).split(",")
    assert fields[1] == "Montserrat ExtraBold"  # familia real de la fuente incluida
    assert (fields[7], fields[8]) == ("0", "-1")  # sin negrita sintética, cursiva
    assert int(fields[16]) <= 2 and int(fields[17]) > 0  # borde fino y sombra
    line = events(ass)[1]
    assert r"{\blur3}" in line  # sombra suave
    assert r"\fscx118\fscy118\t(0,140,\fscx100\fscy100)}LANZÓ" in line  # la palabra salta


def test_pop_without_highlight_keeps_the_color():
    style = SubtitleStyle(highlight=False, animation="pop")
    line = events(captions.build_ass(WORDS, style, 1080, 1920))[1]
    assert r"\fscx118" in line and "&H0000D4FF" not in line


def test_bundled_fonts_exist():
    names = {p.name for p in captions.FONTS_DIR.glob("*.ttf")}
    assert {"Montserrat-ExtraBold.ttf", "Montserrat-ExtraBoldItalic.ttf"} <= names
    assert (captions.FONTS_DIR / "OFL.txt").exists()


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="requiere FFmpeg")
def test_libass_uses_the_bundled_font(tmp_path):
    style = SubtitleStyle(font="Montserrat", italic=True, edge="shadow", animation="pop")
    (tmp_path / "subs.ass").write_text(captions.build_ass(WORDS, style, 360, 640), encoding="utf-8")
    shutil.copytree(captions.FONTS_DIR, tmp_path / "fonts")
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=gray:s=360x640:d=1",
            "-vf",
            "ass=subs.ass:fontsdir=fonts",
            "-frames:v",
            "5",
            "out.mp4",
        ],
        cwd=tmp_path,
        capture_output=True,
    )
    assert proc.returncode == 0, proc.stderr.decode(errors="replace")


# --- texto en pantalla de las escenas ---


def texts_of(ass: str, style: str = "Text") -> list[str]:
    return [
        line for line in ass.splitlines() if line.startswith("Dialogue:") and f",{style}," in line
    ]


def test_scene_text_breaks_at_separators():
    limit = captions.line_chars(1080, captions.scene_text_size(1080, 1920, False))
    assert limit == 21
    long = "María Marta García Belsunce · 50 años · socióloga"
    assert captions.layout_text(long, limit) == "María Marta García Belsunce\n50 años · socióloga"
    assert captions.layout_text("36 DÍAS", limit) == "36 DÍAS"
    # Los saltos de línea del guion se respetan.
    assert captions.layout_text("2024 · Perpetua\n2025 · Confirmada", limit) == (
        "2024 · Perpetua\n2025 · Confirmada"
    )


def test_scene_text_position_style_and_animations():
    item = captions.SceneText(1.0, 4.0, "María Marta García Belsunce · 50 años · socióloga", False)
    ass = captions.build_ass(WORDS, SubtitleStyle(), 1080, 1920, [item], TextStyle())
    [event] = texts_of(ass)
    # Arriba (hay subtítulos), centrado, con las líneas cortadas en el separador y pop.
    assert event.startswith("Dialogue: 1,0:00:01.00,0:00:04.00,Text,")
    assert r"\pos(540,307)" in event and r"\fscx60" in event and r"\fad(90,150)" in event
    assert r"María Marta García Belsunce\N50 años · socióloga" in event
    assert "Style: Text,Montserrat ExtraBold,134," in ass  # 83 px en la vista previa
    assert ",5,54,54,0,1" in ass  # centrado (\an5) y márgenes del 5 %

    # Sin subtítulos baja al tercio inferior; mayúsculas y caja oscura.
    boxed = TextStyle(uppercase=True, box=True, animation="slide", font="Arial")
    ass = captions.build_ass([], SubtitleStyle(), 1080, 1920, [item], boxed)
    [event] = texts_of(ass)
    assert r"\move(540,1556,540,1498,0,300)" in event and "MARÍA MARTA" in event
    assert "Style: Text,Arial,95,&H00FFFFFF,&H00FFFFFF,&H55000000," in ass
    assert ",-1,0,0,0,100,100,0,0,3," in ass  # BorderStyle 3: caja

    # Escena de texto sobre negro: centrada y más grande.
    black = captions.SceneText(0, 2, "27 de octubre de 2002", True)
    ass = captions.build_ass([], SubtitleStyle(), 1080, 1920, [black], TextStyle(animation="fade"))
    [event] = texts_of(ass, "TextCenter")
    assert r"\pos(540,960)\fad(300,150)" in event


def test_typewriter_reveals_letters_without_moving_lines():
    item = captions.SceneText(0.0, 3.0, "Un fragmento de bala", False)
    ass = captions.build_ass(
        [], SubtitleStyle(), 1080, 1920, [item], TextStyle(animation="typewriter")
    )
    events = texts_of(ass)
    assert len(events) == 20  # un paso por letra (hasta 30)
    # Lo que falta se escribe transparente: el texto completo ocupa su lugar desde el inicio.
    assert events[0].endswith(r"U{\alpha&HFF&}n fragmento de bala")
    assert events[-1].endswith(r"\fad(0,150)}Un fragmento de bala")
    assert events[-1].split(",")[2] == "0:00:03.00"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="requiere FFmpeg")
def test_libass_renders_scene_text(tmp_path):
    item = captions.SceneText(0, 1, "Un fragmento de bala", False)
    (tmp_path / "t.ass").write_text(
        captions.build_ass([], SubtitleStyle(), 360, 640, [item], TextStyle()), encoding="utf-8"
    )
    shutil.copytree(captions.FONTS_DIR, tmp_path / "fonts")
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=360x640:d=1",
         "-vf", "ass=t.ass:fontsdir=fonts", "-ss", "0.5", "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        cwd=tmp_path, capture_output=True, check=True,
    ).stdout  # fmt: skip
    rows = [out[y * 360 : (y + 1) * 360] for y in range(640)]
    lit = [y for y, row in enumerate(rows) if max(row) > 200]
    # El texto está en el tercio inferior (centro al 78 %).
    assert lit and 440 < sum(lit) / len(lit) < 560
