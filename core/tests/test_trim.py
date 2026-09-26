"""Recorte visual del tramo: tira de fotogramas, duración de la escena y videos por ajustar."""

import subprocess

import httpx
from PIL import Image

from tests.conftest import wait_job
from tests.media_support import search


def make_clip(path, seconds=6):
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=270x480:rate=10",
            "-t",
            str(seconds),
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
    )


def choose_and_download(client, pid, scene):
    first = search(client, scene).json()["scene"]["candidates"][0]
    client.put(f"/api/scenes/{scene}/candidates/{first['id']}/selected", json={"selected": True})
    job = client.post(f"/api/projects/{pid}/media:download-selected").json()
    return wait_job(client, job["id"])


def test_download_selected_lists_videos_longer_than_their_scene(client, media_project, web):
    pid = media_project["id"]
    video, image = media_project["scenes"][:2]
    choose_and_download(client, pid, image)  # imagen: nunca necesita tramo
    job = choose_and_download(client, pid, video)
    media = client.get(f"/api/scenes/{video}/media").json()
    [main] = [a for a in media["approved"] if a["role"] == "main"]
    # El clip simulado de Pexels dura 12 s; la escena, 2 s (tiempos estimados).
    assert job["result"]["trim"] == [{"scene_id": video, "asset_id": main["asset"]["id"]}]

    framing = client.get(f"/api/scenes/{video}/assets/{main['asset']['id']}/framing").json()
    assert framing["scene_duration_s"] == 2.0
    assert framing["source_duration_s"] == 12.0

    # Con el tramo elegido deja de pedirse.
    saved = client.put(
        f"/api/scenes/{video}/assets/{main['asset']['id']}/framing",
        json={"mode": "none", "trim_in_s": 3.0, "trim_out_s": 5.0},
    )
    assert saved.status_code == 200, saved.text
    from sqlmodel import Session

    from guionaria_core.db import get_engine
    from guionaria_core.models import Scene
    from guionaria_core.services.media.framing import needs_trim

    with Session(get_engine()) as session:
        assert needs_trim(session, session.get(Scene, video)) is False


def test_filmstrip_of_a_real_video(client, media_project, web, tmp_path):
    clip = tmp_path / "clip.mp4"
    make_clip(clip)
    web.respond(
        "https://videos.pexels.com/10-hd.mp4",
        httpx.Response(200, content=clip.read_bytes(), headers={"content-type": "video/mp4"}),
    )
    pid = media_project["id"]
    video = media_project["scenes"][0]
    choose_and_download(client, pid, video)
    asset = client.get(f"/api/scenes/{video}/media").json()["approved"][0]["asset"]

    resp = client.get(f"/api/assets/{asset['id']}/filmstrip?frames=6")
    assert resp.status_code == 200
    strip = tmp_path / "tira.jpg"
    strip.write_bytes(resp.content)
    with Image.open(strip) as img:
        w, h = img.size
    assert h == 90
    assert w == 6 * 50  # 6 fotogramas de 270×480 a 90 px de alto (ancho par: 50 px)
    # La segunda vez se reutiliza.
    assert client.get(f"/api/assets/{asset['id']}/filmstrip?frames=6").content == resp.content


def test_filmstrip_rejects_images(client, media_project, web):
    image = media_project["scenes"][1]
    choose_and_download(client, media_project["id"], image)
    asset = client.get(f"/api/scenes/{image}/media").json()["approved"][0]["asset"]
    assert client.get(f"/api/assets/{asset['id']}/filmstrip").status_code == 404


def test_trim_after_download_setting_defaults_off(client):
    assert client.get("/api/settings").json()["trim_after_download"] is False
