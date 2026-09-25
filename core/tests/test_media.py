import io
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlmodel import Session, select

from guionaria_core.db import get_engine
from guionaria_core.models import Asset, SceneAsset, SceneCandidate
from guionaria_core.services.media import http as media_http
from guionaria_core.services.media import service as media_service
from tests.conftest import wait_job

# --- datos simulados ---------------------------------------------------------------

GUION = {
    "titulo_tentativo": "T",
    "segmentos": [
        {"seccion": "gancho", "texto": "Uno dos tres cuatro."},
        {"seccion": "contexto", "texto": "Cinco seis siete ocho."},
        {"seccion": "contexto", "texto": "Nueve diez once doce."},
        {"seccion": "cierre", "texto": "Trece catorce quince dieciséis."},
    ],
}
ESCENAS = {
    "escenas": [
        {
            "seg_key": "seg_001",
            "tipo": "video",
            "descripcion_visual": "Toma aérea",
            "busqueda_en": "mexico city aerial",
        },
        {
            "seg_key": "seg_002",
            "tipo": "imagen",
            "descripcion_visual": "Calle",
            "busqueda_en": "street night",
        },
        {
            "seg_key": "seg_003",
            "tipo": "real",
            "descripcion_visual": "Foto real",
            "busqueda_real": "priscila loera foto",
        },
        {
            "seg_key": "seg_004",
            "tipo": "texto",
            "descripcion_visual": "Texto",
            "texto_pantalla": "SIN RESPUESTA",
        },
    ]
}


def jpeg_bytes(w=64, h=100, color=(200, 80, 20)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "JPEG")
    return buf.getvalue()


def pexels_photo(i, w=1080, h=1920):
    return {
        "id": i,
        "width": w,
        "height": h,
        "url": f"https://www.pexels.com/photo/{i}/",
        "photographer": f"Autor {i}",
        "src": {
            "original": f"https://images.pexels.com/{i}.jpeg",
            "medium": f"https://images.pexels.com/{i}-m.jpeg",
        },
    }


def pexels_video(i):
    return {
        "id": i,
        "width": 2160,
        "height": 3840,
        "duration": 12,
        "url": f"https://www.pexels.com/video/{i}/",
        "image": f"https://images.pexels.com/v{i}.jpg",
        "user": {"name": f"Video {i}"},
        "video_files": [
            {
                "quality": "uhd",
                "file_type": "video/mp4",
                "width": 2160,
                "height": 3840,
                "link": f"https://videos.pexels.com/{i}-4k.mp4",
            },
            {
                "quality": "hd",
                "file_type": "video/mp4",
                "width": 1080,
                "height": 1920,
                "link": f"https://videos.pexels.com/{i}-hd.mp4",
            },
            {
                "quality": "sd",
                "file_type": "video/mp4",
                "width": 360,
                "height": 640,
                "link": f"https://videos.pexels.com/{i}-sd.mp4",
            },
        ],
    }


def pixabay_video(i, w, h):
    return {
        "id": i,
        "pageURL": f"https://pixabay.com/videos/{i}/",
        "duration": 8,
        "user": f"px{i}",
        "videos": {
            "large": {
                "url": f"https://cdn.pixabay.com/{i}-l.mp4",
                "width": w * 2,
                "height": h * 2,
                "thumbnail": f"https://cdn.pixabay.com/{i}-l.jpg",
            },
            "medium": {
                "url": f"https://cdn.pixabay.com/{i}-m.mp4",
                "width": w,
                "height": h,
                "thumbnail": f"https://cdn.pixabay.com/{i}-m.jpg",
            },
            "tiny": {
                "url": f"https://cdn.pixabay.com/{i}-t.mp4",
                "width": w // 3,
                "height": h // 3,
                "thumbnail": f"https://cdn.pixabay.com/{i}-t.jpg",
            },
        },
    }


def pixabay_image(i):
    return {
        "id": i,
        "pageURL": f"https://pixabay.com/photos/{i}/",
        "user": f"px{i}",
        "webformatURL": f"https://cdn.pixabay.com/{i}-w.jpg",
        "largeImageURL": f"https://cdn.pixabay.com/{i}-L.jpg",
        "imageWidth": 1280,
        "imageHeight": 1920,
    }


class FakeWeb:
    """Transporte HTTP simulado: APIs de Pexels/Pixabay y descarga de archivos."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.overrides: dict[str, list] = {}  # prefijo de URL → respuestas en orden

    def respond(self, prefix, *responses):
        self.overrides[prefix] = list(responses)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        for prefix, queue in self.overrides.items():
            if url.startswith(prefix) and queue:
                r = queue.pop(0)
                return r if isinstance(r, httpx.Response) else httpx.Response(r)
        host, path = request.url.host, request.url.path
        if host == "api.pexels.com" and path == "/v1/search":
            return httpx.Response(200, json={"photos": [pexels_photo(1), pexels_photo(2)]})
        if host == "api.pexels.com" and path == "/videos/search":
            return httpx.Response(200, json={"videos": [pexels_video(10)]})
        if host == "pixabay.com" and path == "/api/videos/":
            # Uno vertical y uno horizontal: el horizontal debe filtrarse en un reel.
            return httpx.Response(
                200, json={"hits": [pixabay_video(20, 540, 960), pixabay_video(21, 960, 540)]}
            )
        if host == "pixabay.com" and path == "/api/":
            return httpx.Response(200, json={"hits": [pixabay_image(30)]})
        if path.endswith((".jpg", ".jpeg")):
            return httpx.Response(200, content=jpeg_bytes(), headers={"content-type": "image/jpeg"})
        if path.endswith(".mp4"):
            return httpx.Response(
                200,
                content=b"\x00\x00\x00\x18ftypmp42" + b"0" * 2048,
                headers={"content-type": "video/mp4"},
            )
        return httpx.Response(404)

    def api_calls(self):
        return [r for r in self.requests if r.url.host in ("api.pexels.com", "pixabay.com")]


@pytest.fixture
def web(monkeypatch):
    fake = FakeWeb()
    monkeypatch.setattr(
        media_http,
        "client_factory",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)),
    )
    monkeypatch.setattr(media_service, "RETRY_DELAYS", (0, 0, 0))
    return fake


def set_keys(client, pexels="pk", pixabay="xk"):
    settings = client.get("/api/settings").json()
    settings["api_keys"].update(pexels=pexels, pixabay=pixabay)
    client.put("/api/settings", json=settings)


@pytest.fixture
def media_project(client, fake_claude, project, web):
    """Reel con guion y escenas aprobados; escenas: video, imagen, real y texto."""
    pid = project["id"]
    fake_claude.queue(GUION)
    wait_job(client, client.post(f"/api/projects/{pid}/script:generate").json()["id"])
    client.post(f"/api/projects/{pid}/script:approve")
    fake_claude.queue(ESCENAS)
    wait_job(
        client,
        client.post(f"/api/projects/{pid}/scenes:generate", json={"mode": "all"}).json()["id"],
    )
    assert client.post(f"/api/projects/{pid}/scenes:approve").status_code == 200
    set_keys(client)
    scenes = client.get(f"/api/projects/{pid}/scenes").json()["scenes"]
    return {"id": pid, "scenes": [s["id"] for s in scenes]}


def search(client, scene_id, **body):
    return client.post(f"/api/scenes/{scene_id}/search", json=body)


def status_of(client, pid):
    return client.get(f"/api/projects/{pid}").json()["status"]


def download(client, scene_id, candidate_ids):
    job = client.post(
        f"/api/scenes/{scene_id}/candidates:download", json={"candidate_ids": candidate_ids}
    )
    assert job.status_code == 202
    return wait_job(client, job.json()["id"])


# --- búsqueda ----------------------------------------------------------------------


def test_search_requires_approved_scenes(client, fake_claude, project, web):
    pid = project["id"]
    fake_claude.queue(GUION)
    wait_job(client, client.post(f"/api/projects/{pid}/script:generate").json()["id"])
    client.post(f"/api/projects/{pid}/script:approve")
    fake_claude.queue(ESCENAS)
    wait_job(client, client.post(f"/api/projects/{pid}/scenes:generate").json()["id"])
    scene_id = client.get(f"/api/projects/{pid}/scenes").json()["scenes"][0]["id"]
    resp = search(client, scene_id)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Aprueba las escenas antes de buscar medios"


def test_search_video_scene_both_providers(client, media_project, web):
    video_scene = media_project["scenes"][0]
    resp = search(client, video_scene)
    assert resp.status_code == 200
    body = resp.json()
    assert body["warnings"] == []
    candidates = body["scene"]["candidates"]
    # Pexels (1 video) y Pixabay (el horizontal se descarta en un reel), intercalados.
    assert [(c["provider"], c["provider_id"]) for c in candidates] == [
        ("pexels", "10"),
        ("pixabay", "20"),
    ]
    pexels = candidates[0]
    assert pexels["kind"] == "video"
    assert pexels["full_url"].endswith("10-hd.mp4")  # la variante más cercana a 1080p, no 4K
    assert pexels["video_preview_url"].endswith("10-sd.mp4")
    assert pexels["query"] == "mexico city aerial"
    assert candidates[1]["full_url"].endswith("20-l.mp4")  # 1080×1920

    [px_req] = [r for r in web.api_calls() if r.url.host == "api.pexels.com"]
    assert px_req.headers["authorization"] == "pk"
    assert px_req.url.params["orientation"] == "portrait"
    assert px_req.url.params["query"] == "mexico city aerial"
    [pb_req] = [r for r in web.api_calls() if r.url.host == "pixabay.com"]
    assert pb_req.url.params["key"] == "xk"

    assert body["scene"]["status"] == "candidates"
    assert status_of(client, media_project["id"]) == "MEDIOS_EN_REVISION"


def test_search_image_and_real_scenes_use_image_endpoints(client, media_project, web):
    image_scene, real_scene = media_project["scenes"][1:3]
    search(client, image_scene)
    pixabay = [r for r in web.api_calls() if r.url.host == "pixabay.com"][-1]
    assert pixabay.url.path == "/api/"
    assert pixabay.url.params["orientation"] == "vertical"
    assert pixabay.url.params["image_type"] == "photo"

    body = search(client, real_scene).json()
    assert body["scene"]["default_query"] == "priscila loera foto"
    assert (
        web.api_calls()[-1].url.params.get("query", web.api_calls()[-1].url.params.get("q"))
        == "priscila loera foto"
    )


def test_any_orientation_and_custom_query_and_provider_subset(client, media_project, web):
    image_scene = media_project["scenes"][1]
    search(client, image_scene, query="rainy street", providers=["pexels"], any_orientation=True)
    [req] = web.api_calls()
    assert req.url.host == "api.pexels.com"
    assert "orientation" not in req.url.params
    assert req.url.params["query"] == "rainy street"


def test_text_scene_does_not_need_media(client, media_project, web):
    resp = search(client, media_project["scenes"][3])
    assert resp.status_code == 400
    assert "no necesitan medio" in resp.json()["detail"]


def test_missing_keys(client, media_project, web):
    set_keys(client, pexels="", pixabay="")
    resp = search(client, media_project["scenes"][0])
    assert resp.status_code == 400
    assert "Ajustes" in resp.json()["detail"]

    set_keys(client, pexels="pk", pixabay="")
    body = search(client, media_project["scenes"][0]).json()
    assert body["warnings"] == ["Pixabay: falta la clave de API (Ajustes → Claves de API)"]
    assert {c["provider"] for c in body["scene"]["candidates"]} == {"pexels"}


@pytest.mark.parametrize(
    ("status", "message"), [(401, "rechazó la clave"), (429, "límite de búsquedas")]
)
def test_provider_errors_become_warnings(client, media_project, web, status, message):
    web.respond("https://api.pexels.com", httpx.Response(status))
    body = search(client, media_project["scenes"][0]).json()
    assert len(body["warnings"]) == 1
    assert message in body["warnings"][0]
    assert {c["provider"] for c in body["scene"]["candidates"]} == {"pixabay"}


def test_search_cache_and_paging(client, media_project, web):
    scene = media_project["scenes"][1]
    search(client, scene)
    calls = len(web.api_calls())
    search(client, scene)  # misma búsqueda: sale de la caché
    assert len(web.api_calls()) == calls

    web.respond(
        "https://api.pexels.com/v1/search", httpx.Response(200, json={"photos": [pexels_photo(3)]})
    )
    body = search(client, scene, page=2).json()
    assert len(web.api_calls()) == calls + 2
    ids = [c["provider_id"] for c in body["scene"]["candidates"]]
    assert ids == ["1", "30", "2", "3"]  # la página 2 se agrega
    assert body["has_more"] is False


def test_new_search_keeps_selected_and_downloaded(client, media_project, web):
    scene = media_project["scenes"][1]
    first = search(client, scene).json()["scene"]["candidates"]
    download(client, scene, [first[0]["id"]])
    body = search(client, scene, query="otra cosa", providers=["pixabay"]).json()
    kept = [(c["provider"], c["provider_id"]) for c in body["scene"]["candidates"]]
    assert ("pexels", "1") in kept  # descargado: se conserva
    assert ("pexels", "2") not in kept  # ni elegido ni descargado: se descarta


# --- descarga ------------------------------------------------------------------------


def test_download_creates_asset_thumbnail_and_hash(client, media_project, web, home):
    scene = media_project["scenes"][1]
    candidates = search(client, scene).json()["scene"]["candidates"]
    job = download(client, scene, [c["id"] for c in candidates])
    assert job["status"] == "done"
    assert job["result"] == {"requested": 3, "downloaded": 3, "failed": 0}

    media = client.get(f"/api/scenes/{scene}/media").json()
    first = media["candidates"][0]
    assert first["download_status"] == "done"
    assert first["selected"] is True
    asset = first["asset"]
    assert asset["file_name"] == "002_pexels_1.jpg"
    assert (asset["width"], asset["height"]) == (64, 100)  # medidas reales del archivo
    assert asset["orientation"] == "portrait"
    assert asset["license"] == "Pexels License"
    assert asset["low_res"] is False
    assert asset["size_bytes"] > 0
    with Session(get_engine()) as s:
        row = s.get(Asset, asset["id"])
        assert row.phash and len(row.phash) == 16
        assert (home / row.thumb_path).exists()
        assert row.file_path.endswith("media/candidates/002_pexels_1.jpg")

    thumb = client.get(asset["thumb_url"])
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"
    assert client.get(asset["file_url"]).content.startswith(b"\xff\xd8")


def test_download_retries_server_errors(client, media_project, web):
    scene = media_project["scenes"][1]
    [c1, *_] = search(client, scene).json()["scene"]["candidates"]
    web.respond("https://images.pexels.com/1.jpeg", httpx.Response(503), httpx.Response(502))
    job = download(client, scene, [c1["id"]])
    assert job["result"]["downloaded"] == 1
    tries = [r for r in web.requests if str(r.url) == "https://images.pexels.com/1.jpeg"]
    assert len(tries) == 3


def test_download_falls_back_to_preview_as_low_res(client, media_project, web):
    scene = media_project["scenes"][1]
    [c1, *_] = search(client, scene).json()["scene"]["candidates"]
    web.respond("https://images.pexels.com/1.jpeg", httpx.Response(403))
    download(client, scene, [c1["id"]])
    cand = client.get(f"/api/scenes/{scene}/media").json()["candidates"][0]
    assert cand["download_status"] == "done"
    assert cand["asset"]["low_res"] is True
    assert cand["asset"]["file_name"] == "002_pexels_1_baja.jpg"


def test_download_failure_is_reported(client, media_project, web):
    scene = media_project["scenes"][0]
    [c1, _] = search(client, scene).json()["scene"]["candidates"]
    web.respond("https://videos.pexels.com/10-hd.mp4", httpx.Response(404))
    job = download(client, scene, [c1["id"]])
    assert job["result"] == {"requested": 1, "downloaded": 0, "failed": 1}
    cand = client.get(f"/api/scenes/{scene}/media").json()["candidates"][0]
    assert cand["download_status"] == "failed"
    assert "HTTP 404" in cand["error"] and "navegador" in cand["error"]


def test_download_rejects_foreign_candidates(client, media_project, web):
    a, b = media_project["scenes"][:2]
    [ca, _] = search(client, a).json()["scene"]["candidates"]
    job = download(client, b, [ca["id"]])
    assert job["status"] == "failed"
    assert "no pertenece" in job["error"]


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="requiere ffmpeg")
def test_real_video_is_probed_and_thumbnailed(client, media_project, web, tmp_path):
    clip = tmp_path / "clip.mp4"
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
            "2",
            "-pix_fmt",
            "yuv420p",
            str(clip),
        ],
        check=True,
    )
    web.respond(
        "https://videos.pexels.com/10-hd.mp4",
        httpx.Response(200, content=clip.read_bytes(), headers={"content-type": "video/mp4"}),
    )
    scene = media_project["scenes"][0]
    [c1, _] = search(client, scene).json()["scene"]["candidates"]
    download(client, scene, [c1["id"]])
    asset = client.get(f"/api/scenes/{scene}/media").json()["candidates"][0]["asset"]
    assert (asset["width"], asset["height"]) == (270, 480)
    assert asset["duration_s"] == pytest.approx(2.0, abs=0.2)
    assert asset["thumb_url"]
    assert client.get(asset["thumb_url"]).status_code == 200


# --- aprobación por escena -------------------------------------------------------------


def downloaded(client, scene):
    candidates = search(client, scene).json()["scene"]["candidates"]
    download(client, scene, [c["id"] for c in candidates])
    return [c["asset"] for c in client.get(f"/api/scenes/{scene}/media").json()["candidates"]]


def approved_dir(home):
    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    return folder / "media" / "approved"


def test_approve_main_and_alternates_with_naming(client, media_project, web, home):
    scene = media_project["scenes"][1]
    a1, a2, a3 = downloaded(client, scene)
    media = client.post(f"/api/scenes/{scene}/assets/{a1['id']}:approve").json()
    assert media["status"] == "approved"
    assert [(x["role"], x["file_name"]) for x in media["approved"]] == [
        ("main", "002_0002_imagen_street-night.jpg"),
    ]
    media = client.post(
        f"/api/scenes/{scene}/assets/{a2['id']}:approve", json={"role": "alt"}
    ).json()
    assert [x["file_name"] for x in media["approved"]] == [
        "002_0002_imagen_street-night.jpg",
        "002_0002_imagen_street-night_alt1.jpg",
    ]
    files = sorted(p.name for p in approved_dir(home).iterdir())
    assert files == ["002_0002_imagen_street-night.jpg", "002_0002_imagen_street-night_alt1.jpg"]

    # Otro principal reemplaza al anterior (su copia se borra; el candidato sigue descargado).
    media = client.post(f"/api/scenes/{scene}/assets/{a3['id']}:approve").json()
    main = [x for x in media["approved"] if x["role"] == "main"]
    assert [x["asset"]["id"] for x in main] == [a3["id"]]
    assert len(list(approved_dir(home).iterdir())) == 2


def test_unapprove_main(client, media_project, web, home):
    scene = media_project["scenes"][1]
    a1, *_ = downloaded(client, scene)
    client.post(f"/api/scenes/{scene}/assets/{a1['id']}:approve")
    media = client.post(f"/api/scenes/{scene}/assets/{a1['id']}:unapprove").json()
    assert media["approved"] == []
    assert media["status"] == "candidates"
    assert list(approved_dir(home).iterdir()) == []
    assert client.post(f"/api/scenes/{scene}/assets/{a1['id']}:unapprove").status_code == 404


def test_approve_foreign_asset_rejected(client, media_project, web):
    a, b = media_project["scenes"][:2]
    [asset, *_] = downloaded(client, b)
    resp = client.post(f"/api/scenes/{a}/assets/{asset['id']}:approve")
    assert resp.status_code == 400


def test_approved_files_are_renamed_when_order_changes(client, media_project, web, home):
    pid = media_project["id"]
    video, image, real, text = media_project["scenes"]
    [asset, *_] = downloaded(client, image)
    client.post(f"/api/scenes/{image}/assets/{asset['id']}:approve")
    assert (approved_dir(home) / "002_0002_imagen_street-night.jpg").exists()

    client.post(f"/api/projects/{pid}/scenes:unlock")
    client.post(
        f"/api/projects/{pid}/scenes:reorder", json={"scene_ids": [image, video, real, text]}
    )
    names = sorted(p.name for p in approved_dir(home).iterdir())
    assert names == ["001_0000_imagen_street-night.jpg"]
    media = client.get(f"/api/scenes/{image}/media").json()
    assert media["approved"][0]["file_name"] == "001_0000_imagen_street-night.jpg"


# --- aprobación de la etapa ------------------------------------------------------------


def test_approve_media_requires_every_scene_with_media(client, media_project, web):
    pid = media_project["id"]
    video, image, real, _text = media_project["scenes"]
    for scene in (video, image):
        [asset, *_] = downloaded(client, scene)
        client.post(f"/api/scenes/{scene}/assets/{asset['id']}:approve")

    overview = client.get(f"/api/projects/{pid}/media").json()
    assert (overview["needing_media"], overview["with_media"]) == (3, 2)
    assert overview["configured_providers"] == ["pexels", "pixabay"]
    assert overview["orientation"] == "portrait"
    assert [s["needs_media"] for s in overview["scenes"]] == [True, True, True, False]
    resp = client.post(f"/api/projects/{pid}/media:approve")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Faltan medios en las escenas 3"

    [asset, *_] = downloaded(client, real)
    client.post(f"/api/scenes/{real}/assets/{asset['id']}:approve")
    overview = client.post(f"/api/projects/{pid}/media:approve").json()
    assert overview["approved"] is True
    assert overview["editable"] is False
    assert status_of(client, pid) == "MEDIOS_APROBADOS"

    assert search(client, video).status_code == 409  # bloqueado
    assert client.post(f"/api/projects/{pid}/media:approve").status_code == 409
    assert client.post(f"/api/projects/{pid}/media:unlock").json()["editable"] is True
    assert status_of(client, pid) == "MEDIOS_EN_REVISION"


def test_approve_media_before_starting(client, media_project, web):
    resp = client.post(f"/api/projects/{media_project['id']}/media:approve")
    assert resp.status_code == 409


# --- otros ------------------------------------------------------------------------------


def test_suggest_queries_with_claude(client, media_project, fake_claude):
    fake_claude.queue(
        {"busquedas": ["city drone night", "urban skyline aerial", "downtown lights"]}
    )
    resp = client.post(f"/api/scenes/{media_project['scenes'][0]}/queries:suggest")
    assert resp.json() == {
        "queries": ["city drone night", "urban skyline aerial", "downtown lights"]
    }
    prompt = fake_claude.calls[-1]["prompt"]
    assert "mexico city aerial" in prompt and "vertical" in prompt


def test_asset_endpoints_404(client, media_project):
    assert client.get("/api/assets/999/file").status_code == 404
    assert client.get("/api/assets/999/thumb").status_code == 404


def test_deleting_scene_removes_its_media(client, media_project, web, home):
    pid = media_project["id"]
    image = media_project["scenes"][1]
    [asset, *_] = downloaded(client, image)
    client.post(f"/api/scenes/{image}/assets/{asset['id']}:approve")
    client.post(f"/api/projects/{pid}/scenes:unlock")
    assert client.delete(f"/api/scenes/{image}").status_code == 200
    with Session(get_engine()) as s:
        assert s.exec(select(SceneCandidate).where(SceneCandidate.scene_id == image)).all() == []
        assert s.exec(select(SceneAsset).where(SceneAsset.scene_id == image)).all() == []
    assert list(approved_dir(home).iterdir()) == []


def test_delete_project_with_media(client, media_project, web):
    image = media_project["scenes"][1]
    [asset, *_] = downloaded(client, image)
    client.post(f"/api/scenes/{image}/assets/{asset['id']}:approve")
    assert client.delete(f"/api/projects/{media_project['id']}").status_code == 204
    with Session(get_engine()) as s:
        assert s.exec(select(Asset)).all() == []
        assert s.exec(select(SceneCandidate)).all() == []


def test_interleave_helper():
    from guionaria_core.services.media.service import _interleave

    assert _interleave([[1, 2, 3], ["a"]]) == [1, "a", 2, 3]
    assert _interleave([]) == []


def test_naming_helpers():
    from guionaria_core.models import Scene
    from guionaria_core.services.media.naming import approved_name, mmss_compact

    scene = Scene(
        project_id=1,
        seg_key="s",
        position=5,
        start_s=65.4,
        media_kind="video",
        query_en="Mexico City Night Aerial",
        status="pending",
    )
    assert mmss_compact(65.4) == "0105"
    assert approved_name(scene, ".mp4") == "005_0105_video_mexico-city-night-aerial.mp4"
    assert approved_name(scene, ".mp4", alt_index=1).endswith("_alt1.mp4")
    real = Scene(
        project_id=1,
        seg_key="s",
        position=4,
        start_s=60,
        media_kind="real",
        query_real="Priscila Loera Franco",
        status="pending",
    )
    assert approved_name(real, ".jpg") == "004_0100_real_priscila-loera-franco.jpg"
    assert isinstance(Path, type)


def test_image_hash_detects_near_duplicates():
    from guionaria_core.services.media.process import _image_hash

    base = Image.new("RGB", (200, 120))
    for x in range(200):
        for y in range(120):
            base.putpixel((x, y), (x, y * 2, 100))
    same_resized = base.resize((100, 60))
    other = base.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    def distance(a, b):
        return bin(int(_image_hash(a), 16) ^ int(_image_hash(b), 16)).count("1")

    assert len(_image_hash(base)) == 16
    assert distance(base, same_resized) <= 4
    assert distance(base, other) > 20
