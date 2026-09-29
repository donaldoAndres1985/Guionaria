"""Audio de fondo en bucle, atribución de los sonidos y movimiento más fluido de las fotos."""

import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from guionaria_core.config import VideoLook
from guionaria_core.services.render import look as looks
from guionaria_core.services.render import plan
from guionaria_core.services.render.service import _effect

HAS_FFMPEG = shutil.which("ffmpeg") is not None
KEVIN = (
    '"Tranquility" Kevin MacLeod (incompetech.com)\n'
    "Licensed under Creative Commons: By Attribution 4.0 License\n"
    "http://creativecommons.org/licenses/by/4.0/"
)


# --- movimiento ---


def test_motion_intensity_scales_the_zoom():
    assert plan.zoom_amount(3.0) == 0.09
    assert plan.zoom_amount(3.0, 1.5) == 0.135
    q = plan.quality(1080, 1920, "standard")
    zin = ",".join(plan.effect_filter("zoom_lento_in", q, 90, 3.0, motion=2.0))
    assert "(1+0.18*in/89)" in zin


def test_new_smooth_effects():
    q = plan.quality(1080, 1920, "standard")
    drift = ",".join(plan.effect_filter("deriva_suave", q, 90, 3.0))
    ease = "((in/89)*(in/89)*(3-2*(in/89)))"  # arranca y frena sin tirones
    assert ease in drift and "perspective=" in drift and "0.15+0.7*" in drift
    divine = ",".join(plan.effect_filter("zoom_divino", q, 90, 3.0))
    assert ease in divine and "(1+0.135*" in divine
    assert "gblur=sigma=16" in divine and "blend=all_mode=screen" in divine
    assert "format=gbrp,split" in divine  # mezcla en RGB (en YUV teñía de rosa)


def test_photo_effect_from_the_look_and_celestial_preset():
    celestial = looks.preset("celestial")
    assert (celestial.photo_effect, celestial.motion, celestial.zoom_photos) == (
        "zoom_divino",
        160,
        True,
    )
    assert _effect(None, "image", celestial) == "zoom_divino"
    assert _effect("ken_burns", "image", celestial) == "ken_burns"
    assert _effect(None, "image", VideoLook(zoom_photos=True)) == "zoom_lento_in"


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere FFmpeg")
@pytest.mark.parametrize("effect", ["deriva_suave", "zoom_divino"])
def test_new_effects_render_in_ffmpeg(tmp_path, effect):
    jpg = tmp_path / "foto.jpg"
    Image.new("RGB", (400, 300), (120, 90, 60)).save(jpg)
    q = plan.quality(1080, 1920, "draft")
    seg = plan.Segment(1, 1.0, "image", jpg, 0, effect, None)
    out = tmp_path / "s.mp4"
    subprocess.run(plan.segment_command(seg, q, out, None, None, motion=1.6), check=True)
    assert out.stat().st_size > 1000


# --- audio de fondo en bucle ---


def test_loop_clip_fades_and_own_volume():
    clip = plan.AudioClip(Path("fondo.mp3"), 0, 60.0, loop=True, volume=0.8)
    graph, inputs = plan.audio_filter(None, [], [clip], first_input=1)
    assert inputs == [clip]
    assert "afade=t=in:st=0:d=1.5" in graph and "afade=t=out:st=58.000:d=2" in graph
    assert "volume=0.8" in graph


def upload_music(client, tmp_path, name="tranquility.wav", seconds=1):
    wav = tmp_path / name
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330",
         "-t", str(seconds), str(wav)],
        check=True,
    )  # fmt: skip
    with wav.open("rb") as fh:
        [sound] = client.post(
            "/api/sounds:upload", files={"file": (name, fh, "audio/wav")}, data={"kind": "music"}
        ).json()
    return sound


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere FFmpeg")
def test_background_audio_loops_whole_video_with_attribution(client, media_project, tmp_path):
    pid = media_project["id"]
    sound = upload_music(client, tmp_path)
    # Atribución que pide la licencia (se guarda en el sonido).
    edited = client.patch(f"/api/sounds/{sound['id']}", json={"attribution": KEVIN}).json()
    assert edited["attribution"] == KEVIN

    assert client.get(f"/api/projects/{pid}/background").json()["sound_id"] is None
    state = client.put(
        f"/api/projects/{pid}/background", json={"sound_id": sound["id"], "volume": 60}
    ).json()
    assert (state["title"], state["volume"], state["attribution"]) == ("tranquility", 60, KEVIN)

    # Vista previa: una sola pista de música, todo el video, en bucle y con su volumen.
    preview = client.get(f"/api/projects/{pid}/timeline/preview").json()
    [music] = preview["music"]
    assert music["loop"] is True and music["volume"] == 0.6
    assert music["start_s"] == 0 and music["duration_s"] == preview["duration_s"]

    # Créditos: la atribución va a la descripción.
    credits = client.get(f"/api/projects/{pid}/rights").json()["credits"]
    assert "Música y sonidos:" in credits and "Kevin MacLeod (incompetech.com)" in credits

    # Quitar.
    cleared = client.put(f"/api/projects/{pid}/background", json={"sound_id": None}).json()
    assert cleared["sound_id"] is None
    assert client.get(f"/api/projects/{pid}/timeline/preview").json()["music"] == []
    bad = client.put(f"/api/projects/{pid}/background", json={"sound_id": 999})
    assert bad.status_code == 400


def test_render_loops_background_input(monkeypatch, tmp_path):
    """El render pasa -stream_loop -1 antes del audio de fondo (se repite hasta el final)."""
    from guionaria_core.services.render import service
    from guionaria_core.services.timeline.model import Clip, SceneSpan, TimelineModel

    song = tmp_path / "fondo.mp3"
    song.write_bytes(b"x")
    m = TimelineModel(
        "t", 30, 1080, 1920, 300,
        [SceneSpan(1, "black", 0, 300, None, None, None)],
        None, [], [], [],
        [Clip("fondo.mp3", song, "audio", 0, 300, 0, None, None, 1, True, 0.5)],
    )  # fmt: skip
    captured = {}
    monkeypatch.setattr(service, "_run", lambda args, cwd=None, cancel=None: None)

    def fake_final(args, total, cwd, on_progress, cancel=None):
        captured["args"] = args
        raise RuntimeError("fin")

    monkeypatch.setattr(service, "_run_with_progress", fake_final)
    with pytest.raises(RuntimeError):
        service._render_sync(m, tmp_path, None, "draft", lambda *a: None)
    args = captured["args"]
    i = args.index(str(song))
    assert args[i - 3 : i] == ["-stream_loop", "-1", "-i"]


# --- listado de audios con su atribución, favoritos por canal ---


def test_parse_attribution():
    from guionaria_core.services.sounds import parse_attribution

    assert parse_attribution(KEVIN) == {
        "title": "Tranquility",
        "author": "Kevin MacLeod",
        "license": "CC BY 4.0",
        "license_url": "http://creativecommons.org/licenses/by/4.0/",
    }
    assert parse_attribution("«Amanecer» de Ana Ruiz — CC0 dominio público") == {
        "title": "Amanecer",
        "author": "Ana Ruiz",
        "license": "Dominio público (CC0)",
    }
    assert parse_attribution("texto libre sin formato") == {}


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere FFmpeg")
def test_upload_with_attribution_and_channel_favorites(client, channel, tmp_path, media_project):
    wav = tmp_path / "pista01.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330",
         "-t", "1", str(wav)],
        check=True,
    )  # fmt: skip
    with wav.open("rb") as fh:
        [sound] = client.post(
            "/api/sounds:upload",
            files={"file": ("pista01.wav", fh, "audio/wav")},
            data={"kind": "music", "attribution": KEVIN, "favorite_channel": str(channel["id"])},
        ).json()
    # La atribución completa sola el título, el autor, la licencia y el enlace.
    assert (sound["title"], sound["author"], sound["license"]) == (
        "Tranquility",
        "Kevin MacLeod",
        "CC BY 4.0",
    )
    assert sound["source_url"] == "http://creativecommons.org/licenses/by/4.0/"
    assert sound["attribution"] == KEVIN and sound["favorite_channels"] == [channel["id"]]

    other = upload_music(client, tmp_path, "otra.wav", seconds=2)
    favs = client.get(f"/api/sounds?kind=music&favorite_of={channel['id']}").json()
    assert [s["id"] for s in favs] == [sound["id"]]
    with_attr = client.get("/api/sounds?kind=music&with_attribution=true").json()
    assert [s["id"] for s in with_attr] == [sound["id"]]
    assert other["id"] in [s["id"] for s in client.get("/api/sounds?with_attribution=false").json()]

    # Quitar de favoritos; cualquier canal puede usarlo igual.
    off = client.post(
        f"/api/sounds/{sound['id']}:favorite", json={"channel_id": channel["id"], "favorite": False}
    )
    assert off.json()["favorite_channels"] == []

    # En uso como audio de fondo: no se puede borrar.
    client.put(f"/api/projects/{media_project['id']}/background", json={"sound_id": sound["id"]})
    listed = next(s for s in client.get("/api/sounds").json() if s["id"] == sound["id"])
    assert listed["used_in"] == 1
    assert client.delete(f"/api/sounds/{sound['id']}").status_code == 409
