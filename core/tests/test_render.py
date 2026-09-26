import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from guionaria_core.services.render import plan
from tests.conftest import wait_job
from tests.media_support import downloaded
from tests.test_voice import engines_fake  # noqa: F401  (fixture)

HAS_FFMPEG = shutil.which("ffmpeg") is not None


# --- comandos (sin FFmpeg) ---


def test_quality():
    assert plan.quality(1920, 1080, False).size == "1920x1080"
    draft = plan.quality(1920, 1080, True)
    assert (draft.size, draft.preset, draft.crf) == ("1280x720", "veryfast", 28)
    assert plan.quality(1080, 1920, True).size == "720x1280"


def test_effects():
    q = plan.quality(1080, 1920, False)
    zin = ",".join(plan.effect_filter("zoom_lento_in", q, 60, 2.0))
    assert "scale=2160:3840" in zin and "zoompan=z='1+0.15*on/59'" in zin and "s=1080x1920" in zin
    assert "zoompan=z='1.15-0.15*on/59'" in ",".join(
        plan.effect_filter("zoom_lento_out", q, 60, 2.0)
    )
    assert "x='(iw-iw/zoom)*on/59'" in ",".join(plan.effect_filter("ken_burns", q, 60, 2.0))
    assert "noise=" in ",".join(plan.effect_filter("estatica", q, 60, 2.0))
    assert "rgbashift" in ",".join(plan.effect_filter("glitch", q, 60, 2.0))
    assert "fade=t=out:st=1.40:d=0.60" in ",".join(plan.effect_filter("fundido_negro", q, 60, 2.0))
    assert plan.effect_filter(None, q, 60, 2.0) == [plan.cover(q)]


def test_segment_commands(tmp_path):
    q = plan.quality(1920, 1080, True)
    img = plan.Segment(1, 2.0, "image", Path("a.jpg"), 0, "ken_burns", None)
    args = plan.segment_command(img, q, tmp_path / "s.mp4", None, None)
    assert args[args.index("-loop") + 1] == "1" and args[args.index("-t") + 1] == "2.000"
    vid = plan.Segment(2, 1.5, "video", Path("b.mp4"), 3.0, "camara_rapida", None)
    args = plan.segment_command(vid, q, tmp_path / "s.mp4", None, None)
    assert (
        args[args.index("-ss") + 1] == "3.000" and args[args.index("-t") + 1] == "3.000"
    )  # lee el doble
    vf = args[args.index("-vf") + 1]
    assert "setpts=0.5*PTS" in vf and "tpad=stop_mode=clone" in vf and "trim=duration=1.500" in vf
    text = plan.Segment(3, 1.0, "color", None, 0, None, "SIN RESPUESTA")
    args = plan.segment_command(
        text, q, tmp_path / "s.mp4", tmp_path / "t.txt", "C:/Windows/Fonts/arialbd.ttf"
    )
    assert "color=c=black:s=1280x720" in args[args.index("-i") + 1]
    vf = args[args.index("-vf") + 1]
    assert "drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf'" in vf and "y=(h-text_h)/2" in vf


def test_audio_mix():
    voice = plan.AudioClip(Path("v.wav"), 0, 10)
    hit = plan.AudioClip(Path("s.wav"), 2.5, 0.5)
    music = [plan.AudioClip(Path("m1.mp3"), 0, 6), plan.AudioClip(Path("m2.mp3"), 6, 4)]
    graph, inputs = plan.audio_filter(voice, [hit], music, first_input=1)
    assert [c.path.name for c in inputs] == ["v.wav", "s.wav", "m1.mp3", "m2.mp3"]
    assert "[2:a]" in graph and "adelay=2500|2500[sfx0]" in graph
    assert "amix=inputs=2:normalize=0[music]" in graph
    assert "[music][voicekey]sidechaincompress" in graph  # ducking
    assert graph.endswith(
        "[voicemix][ducked][sfx0]amix=inputs=3:normalize=0,alimiter=limit=0.95[aout]"
    )

    only_music, _ = plan.audio_filter(None, [], music[:1], first_input=1)
    assert "sidechaincompress" not in only_music and only_music.endswith(
        "[music]alimiter=limit=0.95[aout]"
    )
    only_voice, _ = plan.audio_filter(voice, [], [], first_input=1)
    assert only_voice.endswith("[voice]alimiter=limit=0.95[aout]")
    assert plan.audio_filter(None, [], [], first_input=1) == ("", [])


def test_subtitle_filter():
    assert "Alignment=2" in plan.subtitle_filter("subs.srt", True)
    assert plan.subtitle_filter("subs.srt", True).startswith("subtitles=subs.srt:")


def test_state_and_files(client, media_project):
    pid = media_project["id"]
    state = client.get(f"/api/projects/{pid}/render").json()
    assert (state["can_render"], state["reason"]) == (
        False,
        "Aprueba los medios antes de renderizar",
    )
    assert state["default_burn_subtitles"] is True  # reel
    job = client.post(f"/api/projects/{pid}/render", json={"draft": True}).json()
    assert wait_job(client, job["id"])["error"] == "Aprueba los medios antes de renderizar"
    assert client.get(f"/api/projects/{pid}/render/files/proyecto.mp4").status_code == 404
    assert client.get(f"/api/projects/{pid}/render/files/otro.exe").status_code == 404


# --- render real ---


def real_clip(path: Path, seconds: float = 3) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
         "-t", str(seconds), "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )  # fmt: skip
    return path


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error",
         "-show_entries", "stream=codec_type,width,height:format=duration",
         "-of", "default=nw=1", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    info: dict = {"streams": []}
    for line in out.splitlines():
        key, _, value = line.partition("=")
        if key == "codec_type":
            info["streams"].append(value)
        elif value and value != "N/A":
            info[key] = float(value) if key == "duration" else int(value)
    return info


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere ffmpeg")
def test_full_render(client, media_project, web, engines_fake, tmp_path):  # noqa: F811
    pid = media_project["id"]
    video, image, real, text = media_project["scenes"]
    clip = real_clip(tmp_path / "clip.mp4")
    client.post(f"/api/scenes/{video}/assets:import", json={"path": str(clip)})
    for scene in (image, real):
        [a, *_] = downloaded(client, scene)
        client.post(f"/api/scenes/{scene}/assets/{a['id']}:approve")
    assert client.post(f"/api/projects/{pid}/media:approve").status_code == 200
    wait_job(client, client.post(f"/api/projects/{pid}/voice:generate", json={}).json()["id"])

    state = client.get(f"/api/projects/{pid}/render").json()
    assert state["can_render"] and state["has_voice"] and state["has_subtitles"]

    job = wait_job(
        client,
        client.post(f"/api/projects/{pid}/render", json={"draft": True}).json()["id"],
        timeout=180,
    )
    assert job["status"] == "done", job["error"]
    assert (job["result"]["width"], job["result"]["height"], job["result"]["subtitles"]) == (
        720,
        1280,
        True,
    )
    assert (
        client.get(f"/api/projects/{pid}").json()["status"] == "VOZ_LISTA"
    )  # el borrador no cambia el estado

    files = {f["kind"]: f for f in client.get(f"/api/projects/{pid}/render").json()["files"]}
    draft = client.get(files["draft"]["url"])
    assert draft.status_code == 200
    out = tmp_path / "borrador.mp4"
    out.write_bytes(draft.content)
    info = probe(out)
    assert sorted(info["streams"]) == ["audio", "video"]
    assert info["duration"] == pytest.approx(4.9, abs=0.15)
    thumb = tmp_path / "miniatura.jpg"
    thumb.write_bytes(client.get(files["thumbnail"]["url"]).content)
    with Image.open(thumb) as im:
        assert im.size == (1080, 1920)

    job = wait_job(
        client,
        client.post(f"/api/projects/{pid}/render", json={"burn_subtitles": False}).json()["id"],
        timeout=300,
    )
    assert job["status"] == "done", job["error"]
    assert (job["result"]["width"], job["result"]["height"], job["result"]["subtitles"]) == (
        1080,
        1920,
        False,
    )
    assert client.get(f"/api/projects/{pid}").json()["status"] == "RENDERIZADO"
