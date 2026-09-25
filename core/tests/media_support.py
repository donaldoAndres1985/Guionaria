"""Soporte de las pruebas de medios: web simulada (Pexels, Pixabay, archivos) y fixtures."""

import io

import httpx
import pytest
from PIL import Image

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


def downloaded(client, scene):
    candidates = search(client, scene).json()["scene"]["candidates"]
    download(client, scene, [c["id"] for c in candidates])
    return [c["asset"] for c in client.get(f"/api/scenes/{scene}/media").json()["candidates"]]


def approved_dir(home):
    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    return folder / "media" / "approved"
