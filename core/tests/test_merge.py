"""Fusionar dos videos en uno (sección 5.6): suma de duraciones, sin FFmpeg real en la mayoría
de las pruebas (se simula la codificación, como en test_video_framing_job)."""

import shutil
import subprocess

import pytest
from sqlmodel import Session

from guionaria_core.db import get_engine
from guionaria_core.models import Asset
from guionaria_core.services.media import merge, process
from guionaria_core.services.media.process import MediaInfo
from tests.conftest import wait_job
from tests.media_support import downloaded


def set_duration(asset_id, seconds):
    with Session(get_engine()) as s:
        a = s.get(Asset, asset_id)
        a.duration_s = seconds
        s.commit()


def merge_request(client, scene, asset_ids):
    return client.post(f"/api/scenes/{scene}/assets:merge", json={"asset_ids": asset_ids})


def fake_processing(monkeypatch, duration_s):
    """La codificación y el análisis del archivo se simulan: no hace falta FFmpeg real ni un
    archivo de video válido para probar la lógica de guardado."""
    calls = []

    def fake_concat(sources, dest, tw, th):
        calls.append((sources, tw, th))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"fusionado")

    monkeypatch.setattr(merge, "concat_videos", fake_concat)
    monkeypatch.setattr(process, "video_info", lambda p: MediaInfo(1080, 1920, duration_s, None))
    monkeypatch.setattr(process, "make_thumbnail", lambda *a, **kw: None)
    return calls


def test_merge_two_videos_sums_duration_and_approves_when_no_main(
    client, media_project, web, monkeypatch
):
    scene = media_project["scenes"][0]  # escena de video
    a1, a2 = downloaded(client, scene, providers=["pexels", "pixabay"])
    set_duration(a1["id"], 5.0)
    set_duration(a2["id"], 7.5)
    calls = fake_processing(monkeypatch, 12.5)

    resp = merge_request(client, scene, [a1["id"], a2["id"]])
    assert resp.status_code == 202, resp.text
    job = wait_job(client, resp.json()["id"])
    assert job["status"] == "done", job["error"]
    assert job["type"] == "merge_media"
    assert job["result"]["duration_s"] == 12.5
    assert job["result"]["approved"] is True
    assert len(calls) == 1
    assert calls[0][1:] == (1080, 1920)  # formato reel

    media = client.get(f"/api/scenes/{scene}/media").json()
    [main] = [a for a in media["approved"] if a["role"] == "main"]
    assert main["asset"]["id"] == job["result"]["asset_id"]
    assert main["asset"]["duration_s"] == 12.5
    [candidate] = [c for c in media["candidates"] if c["asset"]["id"] == job["result"]["asset_id"]]
    assert candidate["provider"] == "manual"


def test_merge_keeps_existing_main_as_an_extra_candidate(client, media_project, web, monkeypatch):
    scene = media_project["scenes"][0]
    a1, a2 = downloaded(client, scene, providers=["pexels", "pixabay"])
    set_duration(a1["id"], 4.0)
    set_duration(a2["id"], 6.0)
    client.post(f"/api/scenes/{scene}/assets/{a1['id']}:approve")
    fake_processing(monkeypatch, 10.0)

    resp = merge_request(client, scene, [a1["id"], a2["id"]])
    job = wait_job(client, resp.json()["id"])
    assert job["status"] == "done", job["error"]
    assert job["result"]["approved"] is False

    media = client.get(f"/api/scenes/{scene}/media").json()
    [main] = [a for a in media["approved"] if a["role"] == "main"]
    assert main["asset"]["id"] == a1["id"]  # el principal original sigue ahí
    assert any(c["asset"]["id"] == job["result"]["asset_id"] for c in media["candidates"])


def test_merge_validates_inputs(client, media_project, web):
    video, image, *_ = media_project["scenes"]
    [v1] = downloaded(client, video, providers=["pexels"])
    img = downloaded(client, image, providers=["pexels"])[0]

    same = merge_request(client, video, [v1["id"], v1["id"]])
    assert same.status_code == 400
    assert "dos videos distintos" in same.json()["detail"]

    foreign = merge_request(client, video, [v1["id"], img["id"]])
    assert foreign.status_code == 400
    assert "no es un candidato descargado" in foreign.json()["detail"]

    too_few = merge_request(client, video, [v1["id"]])
    assert too_few.status_code == 422  # el esquema exige exactamente 2


def test_merge_rejects_image_kind(client, media_project, web):
    image = media_project["scenes"][1]
    i1, i2, *_ = downloaded(client, image, providers=["pexels", "pixabay"])
    resp = merge_request(client, image, [i1["id"], i2["id"]])
    assert resp.status_code == 400
    assert "Solo se pueden fusionar videos" in resp.json()["detail"]


def make_clip(path, seconds, color):
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"color=c={color}:size=320x180:rate=10",
            "-t", str(seconds), "-pix_fmt", "yuv420p", str(path),
        ],  # fmt: skip
        check=True,
    )


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="requiere ffmpeg")
def test_concat_videos_with_real_ffmpeg(tmp_path):
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    make_clip(a, 1.0, "red")
    make_clip(b, 1.5, "blue")
    dest = tmp_path / "out.mp4"
    merge.concat_videos([a, b], dest, 108, 192)
    info = process.video_info(dest)
    assert (info.width, info.height) == (108, 192)
    assert info.duration_s == pytest.approx(2.5, abs=0.2)
