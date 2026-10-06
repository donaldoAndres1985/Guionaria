"""Videos más cortos que su escena (típico de los hechos con IA): se repiten en bucle con un
fundido en cada unión en vez de congelar el último cuadro."""

from pathlib import Path

import opentimelineio as otio
from sqlmodel import Session

from guionaria_core.config import load_settings, save_settings
from guionaria_core.services.render import plan
from guionaria_core.services.timeline.model import Clip, SceneSpan, TimelineModel
from guionaria_core.services.timeline.writers import to_edl, to_otio
from tests.test_framing import approve, set_asset


def build(project_id):
    from guionaria_core.db import get_engine
    from guionaria_core.models import Project
    from guionaria_core.services.timeline.model import build_timeline

    with Session(get_engine()) as s:
        return build_timeline(s, s.get(Project, project_id))


def short_video_project(client, media_project):
    """Escena 1 con un video que dura 1 s menos que ella."""
    scene = media_project["scenes"][0]
    asset = approve(client, scene, providers=["pexels"])
    span = build(media_project["id"]).scenes[0]
    seconds = span.duration / 30 - 1.0
    assert seconds >= 1.0
    set_asset(asset["id"], duration_s=seconds, width=1080, height=1920)
    return scene, asset, span.duration, round(seconds * 30)


def test_short_video_loops_by_default(client, media_project, web):
    _scene, _asset, scene_len, video_len = short_video_project(client, media_project)
    m = build(media_project["id"])
    clip = m.scenes[0].clip
    assert clip.loop is True
    assert clip.duration == scene_len  # cubre toda la escena
    assert clip.loop_length == video_len
    assert not any("congelado" in w for w in m.warnings)

    preview = client.get(f"/api/projects/{media_project['id']}/timeline/preview").json()
    media = preview["scenes"][0]["media"]
    assert media["duration_s"] == round(scene_len / 30, 3)
    assert media["loop_s"] == round(video_len / 30, 3)


def test_short_video_freezes_when_loop_is_off(client, media_project, web):
    _scene, _asset, _scene_len, video_len = short_video_project(client, media_project)
    settings = load_settings()
    settings.loop_short_videos = False
    save_settings(settings)
    m = build(media_project["id"])
    clip = m.scenes[0].clip
    assert (clip.loop, clip.duration) == (False, video_len)
    assert any("el último cuadro queda congelado" in w for w in m.warnings)


def loop_model(tmp: Path) -> TimelineModel:
    vid = Clip("ia.mp4", tmp / "ia.mp4", "video", 0, 250, 0, 100, 1, loop=True)
    return TimelineModel(
        title="Bucle",
        fps=30,
        width=1920,
        height=1080,
        duration=250,
        scenes=[SceneSpan(1, "video", 0, 250, vid, None, 1)],
        voice=None,
        markers=[],
    )


def test_clip_loop_helpers(tmp_path):
    clip = loop_model(tmp_path).scenes[0].clip
    pieces = clip.loop_pieces()
    assert [(p.start, p.duration, p.source_in, p.loop) for p in pieces] == [
        (0, 100, 0, False),
        (100, 100, 0, False),
        (200, 50, 0, False),
    ]
    assert clip.source_frame(130) == 30  # segunda vuelta
    assert clip.source_frame(10) == 10
    still = Clip("b.mp4", tmp_path / "b.mp4", "video", 0, 40, 5, 45)
    assert still.loop_pieces() == [still]
    assert still.source_frame(500) == 44  # sin bucle: el último cuadro


def test_writers_repeat_looped_clip(tmp_path):
    m = loop_model(tmp_path)
    tl = otio.adapters.read_from_string(to_otio(m), "otio_json")
    video = tl.tracks[0]
    assert [i.source_range.duration.to_frames() for i in video] == [100, 100, 50]
    assert all(type(i).__name__ == "Clip" for i in video)
    assert to_edl(m).count(" V     C ") == 3


def test_loop_plan_covers_needed_time():
    for length, needed in ((3.0, 8.0), (10.0, 24.5), (1.0, 6.0), (4.9, 5.0)):
        n, fade = plan.loop_plan(length, needed)
        assert n * length - (n - 1) * fade >= needed
        assert (n - 1) * length - (n - 2) * fade < needed or n == 2
        assert 0 < fade <= plan.LOOP_FADE
    assert plan.loop_plan(1.0, 1000)[0] == plan.MAX_LOOPS


def test_segment_command_loops_with_crossfades(tmp_path):
    q = plan.quality(1920, 1080, "draft")
    seg = plan.Segment(1, 8.0, "video", tmp_path / "ia.mp4", 2.0, None, None, loop_s=3.0)
    args = plan.segment_command(seg, q, tmp_path / "out.mp4", None, None)
    n, _fade = plan.loop_plan(3.0 - plan.LOOP_SLACK, 8.0)
    assert args.count("-i") == n
    assert args.count("-ss") == n and "2.000" in args
    graph = args[args.index("-filter_complex") + 1]
    assert graph.count("xfade=transition=fade") == n - 1
    assert "tpad=stop_mode=clone" in graph  # red de seguridad si el archivo trae menos cuadros
    assert args[args.index("-map") + 1] == "[v]"
    assert "-vf" not in args

    # Si el video alcanza, el comando de siempre (una entrada y -vf).
    seg.duration = 2.5
    args = plan.segment_command(seg, q, tmp_path / "out.mp4", None, None)
    assert args.count("-i") == 1 and "-vf" in args and "-filter_complex" not in args


def test_segment_command_loop_with_slow_motion(tmp_path):
    q = plan.quality(1920, 1080, "draft")
    seg = plan.Segment(1, 4.0, "video", tmp_path / "ia.mp4", 0, "camara_lenta", None, loop_s=1.5)
    args = plan.segment_command(seg, q, tmp_path / "out.mp4", None, None)
    graph = args[args.index("-filter_complex") + 1]
    # Cámara lenta: hacen falta 2 s de video; el bucle se arma antes de estirar los cuadros.
    assert graph.index("xfade") < graph.index("setpts=2*PTS")
