import shutil
import subprocess
import threading
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlmodel import Session

from guionaria_core.services.media import framing
from guionaria_core.services.media.framing import Crop, center_crop
from guionaria_core.services.media.process import MediaInfo
from tests.conftest import wait_job
from tests.media_support import approved_dir, downloaded, jpeg_bytes


def furl(scene, asset, suffix="framing"):
    return f"/api/scenes/{scene}/assets/{asset}/{suffix}"


def approve(client, scene, **kw):
    [asset, *_] = downloaded(client, scene, **kw)
    client.post(f"/api/scenes/{scene}/assets/{asset['id']}:approve", json={"role": "main"})
    return asset


def approved_file(home):
    [f] = [p for p in approved_dir(home).iterdir() if not p.name.startswith(".")]
    return f


def set_asset(asset_id, **fields):
    from guionaria_core.db import get_engine
    from guionaria_core.models import Asset

    with Session(get_engine()) as s:
        a = s.get(Asset, asset_id)
        for k, v in fields.items():
            setattr(a, k, v)
        s.commit()


def test_center_crop():
    # Horizontal 16:9 en un reel 9:16: se recortan los lados.
    c = center_crop(1920, 1080, 1080, 1920)
    assert (round(c.w, 4), c.h, round(c.x, 4), c.y) == (0.3164, 1, 0.3418, 0)
    # Vertical en un video 16:9: se recortan arriba y abajo.
    c = center_crop(1080, 1920, 1920, 1080)
    assert (c.w, round(c.h, 4), c.x, round(c.y, 4)) == (1, 0.3164, 0, 0.3418)
    with pytest.raises(ValueError, match="se sale"):
        Crop(x=0.5, y=0, w=0.6, h=1)


def test_image_crop_blur_and_reset(client, media_project, web, home):
    web.respond(
        "https://images.pexels.com/1.jpeg", httpx.Response(200, content=jpeg_bytes(1600, 900))
    )
    scene = media_project["scenes"][1]  # imagen, en un reel (1080×1920)
    asset = approve(client, scene, providers=["pexels"])

    state = client.get(furl(scene, asset["id"])).json()
    assert (state["kind"], state["mode"], state["rendered"]) == ("image", "none", False)
    assert (state["target_width"], state["target_height"]) == (1080, 1920)
    assert state["orientation_mismatch"] is True  # foto horizontal en un reel
    suggested = state["suggested_crop"]

    bad = client.put(
        furl(scene, asset["id"]), json={"mode": "crop", "crop": {"x": 0, "y": 0, "w": 1, "h": 1}}
    )
    assert bad.status_code == 400
    assert "proporción del formato" in bad.json()["detail"]
    trim = client.put(furl(scene, asset["id"]), json={"mode": "none", "trim_in_s": 1})
    assert trim.json()["detail"] == "El recorte de tiempo solo aplica a videos"

    saved = client.put(furl(scene, asset["id"]), json={"mode": "crop", "crop": suggested}).json()
    assert saved["job"] is None  # las imágenes se encuadran al instante
    assert (saved["framing"]["mode"], saved["framing"]["rendered"]) == ("crop", True)
    f = approved_file(home)
    assert f.suffix == ".jpg"
    with Image.open(f) as img:
        assert img.size == (1080, 1920)
    media = client.get(f"/api/scenes/{scene}/media").json()
    assert media["approved"][0]["framing_mode"] == "crop"
    preview = client.get(media["approved"][0]["approved_url"])
    assert preview.status_code == 200 and preview.content == f.read_bytes()

    client.put(furl(scene, asset["id"]), json={"mode": "blur"})
    with Image.open(approved_file(home)) as img:
        assert img.size == (1080, 1920)
        assert img.getpixel((540, 30)) != img.getpixel((540, 960))  # fondo desenfocado y oscuro

    client.put(furl(scene, asset["id"]), json={"mode": "none"})
    with Image.open(approved_file(home)) as img:
        assert img.size == (1600, 900)  # vuelve a ser una copia del original
    assert client.get(f"/api/scenes/{scene}/media").json()["approved"][0]["framing_mode"] == "none"


def test_framing_locked_after_media_approval(client, media_project, web):
    video, image, real, _text = media_project["scenes"]
    assets = [approve(client, s) for s in (video, image, real)]
    assert client.post(f"/api/projects/{media_project['id']}/media:approve").status_code == 200
    resp = client.put(furl(image, assets[1]["id"]), json={"mode": "blur"})
    assert resp.status_code == 409
    assert client.get(furl(image, 999)).status_code == 404


def test_video_trim_only_goes_to_timeline(client, media_project, web, home):
    scene = media_project["scenes"][0]
    asset = approve(client, scene, providers=["pexels"])
    set_asset(asset["id"], duration_s=10.0, width=1080, height=1920)

    too_long = client.put(furl(scene, asset["id"]), json={"trim_in_s": 2, "trim_out_s": 12})
    assert too_long.json()["detail"] == "El video dura 10.0 s"
    too_short = client.put(furl(scene, asset["id"]), json={"trim_in_s": 2, "trim_out_s": 2.2})
    assert "al menos 0.5 s" in too_short.json()["detail"]

    saved = client.put(furl(scene, asset["id"]), json={"trim_in_s": 2.5, "trim_out_s": 3.0}).json()
    assert saved["job"] is None  # sin encuadre no se vuelve a codificar
    assert (saved["framing"]["trim_in_s"], saved["framing"]["trim_out_s"]) == (2.5, 3.0)

    from guionaria_core.db import get_engine
    from guionaria_core.models import Project
    from guionaria_core.services.timeline.model import build_timeline

    with Session(get_engine()) as s:
        m = build_timeline(s, s.get(Project, media_project["id"]))
    span = m.scenes[0]
    clip = span.clip
    assert (clip.source_in, clip.media_duration) == (75, 300)  # desde 2,5 s; el archivo, 10 s
    # El tramo (0,5 s) es más corto que la escena: el video sigue en vez de dejar un hueco.
    assert clip.duration == span.duration
    assert not any("congelado" in w for w in m.warnings)

    # Si el archivo no alcanza, se avisa (el render congela el último cuadro).
    client.put(furl(scene, asset["id"]), json={"trim_in_s": 9.5, "trim_out_s": 10.0})
    with Session(get_engine()) as s:
        m = build_timeline(s, s.get(Project, media_project["id"]))
    assert m.scenes[0].clip.duration == 15
    assert any("el video alcanza para 0.5 s" in w for w in m.warnings)


def test_video_framing_job(client, media_project, web, home, monkeypatch):
    scene = media_project["scenes"][0]
    asset = approve(client, scene, providers=["pexels"])
    set_asset(asset["id"], duration_s=10.0, width=1920, height=1080)
    calls = []
    # La codificación simulada espera a que la prueba vea el estado «pendiente» (sin carrera).
    release = threading.Event()

    def fake_render(src, dst, mode, crop, trim_in, trim_out, tw, th):
        calls.append((mode, crop, trim_in, trim_out, tw, th))
        release.wait(10)
        Path(dst).write_bytes(b"encuadrado")

    monkeypatch.setattr(framing, "render_video", fake_render)
    monkeypatch.setattr(framing.process, "video_info", lambda p: MediaInfo(1080, 1920, 4.0, None))
    crop = center_crop(1920, 1080, 1080, 1920).model_dump()
    saved = client.put(
        furl(scene, asset["id"]),
        json={"mode": "crop", "crop": crop, "trim_in_s": 1, "trim_out_s": 5},
    ).json()
    assert saved["framing"]["rendered"] is False
    media = client.get(f"/api/scenes/{scene}/media").json()
    assert media["approved"][0]["framing_pending"] is True
    release.set()
    job = wait_job(client, saved["job"]["id"])
    assert job["status"] == "done", job["error"]
    assert job["type"] == "frame_media"
    assert calls[0][0] == "crop" and calls[0][2:] == (1, 5, 1080, 1920)
    f = approved_file(home)
    assert f.suffix == ".mp4" and f.read_bytes() == b"encuadrado"
    assert client.get(furl(scene, asset["id"])).json()["rendered"] is True

    # El timeline usa el archivo encuadrado desde el inicio (el tramo ya está aplicado).
    from guionaria_core.db import get_engine
    from guionaria_core.models import Project
    from guionaria_core.services.timeline.model import build_timeline

    with Session(get_engine()) as s:
        clip = build_timeline(s, s.get(Project, media_project["id"])).scenes[0].clip
    assert (clip.source_in, clip.media_duration) == (0, 120)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="requiere ffmpeg")
@pytest.mark.parametrize("mode", ["crop", "blur"])
def test_render_video_with_ffmpeg(tmp_path, mode):
    src = tmp_path / "src.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10",
         "-t", "3", "-pix_fmt", "yuv420p", str(src)],
        check=True,
    )  # fmt: skip
    dst = tmp_path / "out.mp4"
    crop = center_crop(320, 180, 108, 192)
    framing.render_video(src, dst, mode, crop, 0.5, 2.0, 108, 192)
    info = framing.process.video_info(dst)
    assert (info.width, info.height) == (108, 192)
    assert info.duration_s == pytest.approx(1.5, abs=0.15)


def test_set_framing_by_mcp(client, media_project, web, home):
    from tests.test_mcp import Mcp

    web.respond(
        "https://images.pexels.com/1.jpeg", httpx.Response(200, content=jpeg_bytes(1600, 900))
    )
    scene = media_project["scenes"][1]
    asset = approve(client, scene, providers=["pexels"])
    out = Mcp(client).call("set_framing", scene_id=scene, asset_id=asset["id"], mode="crop")
    assert out["framing"]["mode"] == "crop" and "job" not in out
    with Image.open(approved_file(home)) as img:
        assert img.size == (1080, 1920)


def eurl(scene, asset):
    return f"/api/scenes/{scene}/assets/{asset}:extend-next"


def test_extend_to_next_scene_reuses_leftover_footage(client, media_project, web):
    video, image, *_ = media_project["scenes"]
    asset = approve(client, video, providers=["pexels"])
    set_asset(asset["id"], duration_s=10.0, width=1080, height=1920)

    before = client.get(furl(video, asset["id"])).json()
    wanted = before["scene_duration_s"]
    assert before["can_extend_next"] is True
    assert before["next_scene_position"] == 2
    assert before["next_scene_has_media"] is False
    assert before["extend_available_s"] == pytest.approx(10.0 - wanted, abs=0.01)

    resp = client.post(eurl(video, asset["id"]), json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["next_scene_id"] == image
    assert body["next_scene_position"] == 2
    assert body["start_s"] == pytest.approx(wanted, abs=0.01)
    assert body["current_job"] is None and body["next_job"] is None
    next_asset_id = body["next_asset_id"]
    assert next_asset_id != asset["id"]  # copia enlazada, no el mismo medio

    media = client.get(f"/api/scenes/{image}/media").json()
    [main] = [a for a in media["approved"] if a["role"] == "main"]
    assert main["asset"]["id"] == next_asset_id
    assert main["trim_in_s"] == pytest.approx(wanted, abs=0.01)

    # No duplica el archivo en disco: es un enlace duro del mismo contenido.
    reused = client.get(f"/api/library?project={media_project['id']}").json()
    item = next(i for i in reused["items"] if i["asset"]["id"] == next_asset_id)
    assert item["reused_from_id"] == asset["id"]


def test_extend_fails_when_next_scene_needs_no_media(client, media_project, web):
    _video, _image, real, _text = media_project["scenes"]
    video_asset = approve(client, media_project["scenes"][0], providers=["pexels"])
    set_asset(video_asset["id"], duration_s=10.0, width=1080, height=1920)
    # Se reutiliza un video en la escena «real» (búsqueda directa) para poder probar el límite.
    reuse = client.post(f"/api/library/{video_asset['id']}:reuse", json={"scene_id": real})
    assert reuse.status_code == 200
    media = client.get(f"/api/scenes/{real}/media").json()
    candidate = next(c for c in media["candidates"] if c["asset"]["id"] != video_asset["id"])
    real_asset_id = candidate["asset"]["id"]
    client.post(f"/api/scenes/{real}/assets/{real_asset_id}:approve", json={"role": "main"})

    resp = client.post(eurl(real, real_asset_id), json={})
    assert resp.status_code == 400
    assert "texto o negro" in resp.json()["detail"]


def test_extend_fails_without_enough_footage(client, media_project, web):
    video, *_ = media_project["scenes"]
    asset = approve(client, video, providers=["pexels"])
    scene_duration_s = client.get(furl(video, asset["id"])).json()["scene_duration_s"]
    set_asset(asset["id"], duration_s=scene_duration_s + 0.2, width=1080, height=1920)

    info = client.get(furl(video, asset["id"])).json()
    assert info["can_extend_next"] is False

    resp = client.post(eurl(video, asset["id"]), json={})
    assert resp.status_code == 400
    assert "suficiente metraje" in resp.json()["detail"]


def test_extend_copies_crop_and_replaces_existing_next_media(
    client, media_project, web, home, monkeypatch
):
    video, image, *_ = media_project["scenes"]
    asset = approve(client, video, providers=["pexels"])
    set_asset(asset["id"], duration_s=10.0, width=1920, height=1080)
    other = approve(client, image, providers=["pexels"])  # la escena 2 ya tiene medio

    calls = []
    monkeypatch.setattr(
        framing,
        "render_video",
        lambda src, dst, mode, crop, trim_in, trim_out, tw, th: (
            calls.append((mode, trim_in, trim_out)),
            Path(dst).write_bytes(b"encuadrado"),
        ),
    )
    monkeypatch.setattr(
        framing.process, "video_info", lambda p: MediaInfo(1080, 1920, 8.0, None)
    )
    crop = center_crop(1920, 1080, 1080, 1920).model_dump()
    resp = client.post(eurl(video, asset["id"]), json={"mode": "crop", "crop": crop})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["current_job"] is not None
    assert body["next_job"] is not None
    wait_job(client, body["current_job"]["id"])
    wait_job(client, body["next_job"]["id"])
    assert len(calls) == 2  # una codificación para cada escena

    media = client.get(f"/api/scenes/{image}/media").json()
    [main] = [a for a in media["approved"] if a["role"] == "main"]
    assert main["asset"]["id"] == body["next_asset_id"]
    assert main["asset"]["id"] != other["id"]  # reemplazó el medio anterior de la escena
    assert main["framing_mode"] == "crop"
