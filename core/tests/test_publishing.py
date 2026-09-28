"""Publicación: metadatos por plataforma, verificación, cola, miniatura y subida a YouTube
(con Google simulado: las pruebas nunca llaman a Google ni abren el navegador)."""

import json
import shutil
import subprocess
import urllib.parse
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlmodel import Session

from tests.conftest import wait_job

HAS_FFMPEG = shutil.which("ffmpeg") is not None

METADATA = {
    "plataformas": [
        {
            "plataforma": "youtube",
            "titulos": ["El secuestro que nadie vio", "36 días de silencio", "¿Quién mintió?"],
            "descripcion": "Un caso que cambió la investigación en México.",
            "hashtags": ["#truecrime", "casos reales", "mexico"],
            "etiquetas": ["caso priscila", "secuestro cdmx", "true crime"],
            "comentario_fijado": "¿Qué crees que pasó?",
        },
        {
            "plataforma": "tiktok",
            "titulos": ["El secuestro que nadie vio"],
            "descripcion": "Nadie vio nada. ¿O sí?",
            "hashtags": ["truecrime", "fyp"],
            "etiquetas": [],
            "comentario_fijado": None,
        },
    ],
    "capitulos": [],
}


@pytest.fixture(autouse=True)
def no_browser(monkeypatch):
    from guionaria_core.services import system

    opened = []
    monkeypatch.setattr(system, "open_url", lambda url: opened.append(url))
    monkeypatch.setattr(system, "reveal", lambda path: opened.append(str(path)))
    return opened


@pytest.fixture
def pub_project(client, channel, project):
    """Proyecto renderizado de un canal que publica en YouTube y TikTok."""
    from guionaria_core.db import get_engine
    from guionaria_core.models import Project
    from guionaria_core.services.publishing.service import final_video

    client.patch(f"/api/channels/{channel['id']}", json={"platforms": ["youtube", "tiktok"]})
    with Session(get_engine()) as s:
        p = s.get(Project, project["id"])
        p.status = "RENDERIZADO"
        video = final_video(p)
        video.parent.mkdir(parents=True, exist_ok=True)
        video.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"0" * 20000)
        s.commit()
    return project


def state_of(client, pid):
    return client.get(f"/api/projects/{pid}/publishing").json()


def status_of(client, pid):
    return client.get(f"/api/projects/{pid}").json()["status"]


def test_rows_per_platform_and_checklist(client, pub_project):
    pid = pub_project["id"]
    state = state_of(client, pid)
    assert state["can_publish"] and state["video_url"].endswith("/proyecto.mp4")
    assert [p["platform"] for p in state["publications"]] == ["youtube", "tiktok"]
    yt, tt = state["publications"]
    assert yt["title"] == "El secuestro" and yt["status"] == "draft" and yt["enabled"]
    assert yt["upload_url"] == "https://www.youtube.com/upload"
    checks = {c["id"]: c for c in yt["checklist"]}
    assert checks["render"]["done"] and not checks["description"]["done"]
    assert checks["kids"]["done"] is False  # hay que decidirlo en YouTube
    assert checks["respect"]["manual"]  # canal de casos reales
    assert "kids" not in {c["id"] for c in tt["checklist"]}
    assert state["youtube"] == {
        "configured": False,
        "connected": False,
        "account": None,
        "redirect_uri": "http://127.0.0.1:8765/api/youtube/oauth/callback",
    }
    # Sin render no se publica.
    from guionaria_core.db import get_engine
    from guionaria_core.models import Project
    from guionaria_core.services.publishing.service import final_video

    with Session(get_engine()) as s:
        final_video(s.get(Project, pid)).unlink()
    state = state_of(client, pid)
    assert not state["can_publish"] and "Renderiza" in state["reason"]


def test_claude_writes_metadata_and_app_adds_credits(client, pub_project, fake_claude):
    pid = pub_project["id"]
    fake_claude.queue(METADATA)
    job = client.post(f"/api/projects/{pid}/publishing:generate").json()
    assert wait_job(client, job["id"])["status"] == "done"
    prompt = fake_claude.calls[0]["prompt"]
    assert "YouTube, TikTok" in prompt and "Casos Reales" in prompt
    assert "Ocurrió en 2008" in prompt  # notas del caso (no hay ficha verificada)

    yt, tt = state_of(client, pid)["publications"]
    assert yt["title"] == "El secuestro que nadie vio"
    assert yt["meta"]["title_options"][1] == "36 días de silencio"
    assert yt["meta"]["hashtags"] == ["truecrime", "casos reales", "mexico"]
    assert yt["tags"] == ["caso priscila", "secuestro cdmx", "true crime"]
    assert yt["meta"]["pinned_comment"] == "¿Qué crees que pasó?"
    # Texto para pegar: descripción, hashtags y (YouTube) los créditos de los medios.
    assert yt["full_text"].startswith("Un caso que cambió la investigación en México.")
    assert "#truecrime #casosreales #mexico" in yt["full_text"]
    assert "Créditos — El secuestro" in yt["full_text"]
    assert "Créditos" not in tt["full_text"]
    assert {c["id"]: c["done"] for c in yt["checklist"]}["credits"]

    # Los textos quedan también en la carpeta publicacion/.
    from guionaria_core.db import get_engine
    from guionaria_core.models import Project
    from guionaria_core.services.projects import project_dir

    with Session(get_engine()) as s:
        folder = project_dir(s.get(Project, pid)) / "publicacion"
    assert "36 días de silencio" in (folder / "youtube.md").read_text(encoding="utf-8")
    assert (folder / "tiktok.md").exists()


def test_schedule_publish_and_project_status(client, pub_project):
    pid = pub_project["id"]
    yt, tt = state_of(client, pid)["publications"]
    past = client.patch(f"/api/publications/{yt['id']}", json={"scheduled_at": "2020-01-01T10:00"})
    assert past.status_code == 400 and "ya pasó" in past.json()["detail"]

    when = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0).isoformat()
    state = client.patch(
        f"/api/publications/{yt['id']}", json={"scheduled_at": when, "made_for_kids": False}
    ).json()
    assert state["publications"][0]["status"] == "scheduled"
    assert status_of(client, pid) == "RENDERIZADO"  # TikTok sigue pendiente

    # TikTok fuera («publicar en» apagado): todo lo activo está programado.
    client.patch(f"/api/publications/{tt['id']}", json={"enabled": False})
    assert status_of(client, pid) == "PROGRAMADO"

    bad = client.post(f"/api/publications/{yt['id']}:published", json={"url": "youtube.com/x"})
    assert bad.status_code in (400, 422)
    state = client.post(
        f"/api/publications/{yt['id']}:published", json={"url": "https://youtu.be/abc123"}
    ).json()
    assert state["publications"][0]["external_url"] == "https://youtu.be/abc123"
    assert status_of(client, pid) == "PUBLICADO"
    locked = client.patch(f"/api/publications/{yt['id']}", json={"title": "Otro"})
    assert locked.status_code == 409

    client.post(f"/api/publications/{yt['id']}:reopen")
    assert status_of(client, pid) == "PROGRAMADO"  # vuelve a programada (tiene fecha)

    # Verificaciones manuales.
    state = client.patch(f"/api/publications/{yt['id']}", json={"checks": {"respect": True}}).json()
    assert {c["id"]: c["done"] for c in state["publications"][0]["checklist"]}["respect"]


def test_queue_orders_pending_by_date(client, pub_project):
    pid = pub_project["id"]
    yt, tt = state_of(client, pid)["publications"]
    soon = (datetime.now(UTC) + timedelta(days=1)).replace(microsecond=0).isoformat()
    client.patch(f"/api/publications/{tt['id']}", json={"scheduled_at": soon})
    client.post(f"/api/publications/{yt['id']}:published", json={"url": "https://youtu.be/x"})
    queue = client.get("/api/publishing/queue").json()
    assert [(q["platform"], q["status"]) for q in queue] == [
        ("tiktok", "scheduled"),
        ("youtube", "published"),
    ]
    assert (
        queue[0]["project_title"] == "El secuestro" and queue[0]["channel_name"] == "Casos Reales"
    )


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere FFmpeg")
def test_thumbnail_from_a_frame(client, pub_project):
    from PIL import Image

    from guionaria_core.db import get_engine
    from guionaria_core.models import Project
    from guionaria_core.services.publishing.service import final_video

    pid = pub_project["id"]
    with Session(get_engine()) as s:
        video = final_video(s.get(Project, pid))
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30",
         "-t", "2", "-pix_fmt", "yuv420p", str(video)],
        check=True,
    )  # fmt: skip
    state = client.post(
        f"/api/projects/{pid}/publishing/thumbnail", json={"time_s": 1.0, "text": "36 días"}
    ).json()
    url = state["publications"][0]["thumbnail_url"]
    assert url.startswith(f"/api/projects/{pid}/publishing/thumbnail?v=")
    resp = client.get(url)
    assert resp.headers["content-type"] == "image/jpeg"
    from io import BytesIO

    assert Image.open(BytesIO(resp.content)).size == (1080, 1920)  # reel
    assert state["publications"][0]["meta"]["thumbnail_text"] == "36 días"


# --- YouTube (Google simulado) ---


class FakeGoogle:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.upload_status = 200
        self.upload_error = None
        self.privacy = None  # lo que YouTube dice que quedó

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url.startswith("https://oauth2.googleapis.com/token"):
            form = urllib.parse.parse_qs(request.content.decode())
            if form["grant_type"] == ["authorization_code"]:
                assert form["code_verifier"][0] and form["code"] == ["codigo"]
                return httpx.Response(
                    200, json={"access_token": "at1", "refresh_token": "rt1", "expires_in": 3600}
                )
            return httpx.Response(200, json={"access_token": "at2", "expires_in": 3600})
        if request.url.path == "/youtube/v3/channels":
            return httpx.Response(
                200, json={"items": [{"id": "UC1", "snippet": {"title": "Casos Reales TV"}}]}
            )
        if request.url.path == "/youtube/v3/playlists":
            return httpx.Response(
                200, json={"items": [{"id": "PL1", "snippet": {"title": "Casos"}}]}
            )
        if request.url.path == "/upload/youtube/v3/videos" and request.method == "POST":
            if self.upload_error:
                return httpx.Response(
                    403, json={"error": {"errors": [{"reason": self.upload_error}], "message": "x"}}
                )
            return httpx.Response(200, headers={"Location": "https://upload.example/sesion"})
        if url == "https://upload.example/sesion":
            first, rest = request.headers["content-range"].split(" ")[1].split("-")
            end, total = (int(x) for x in rest.split("/"))
            if end + 1 < total:  # faltan trozos: YouTube dice hasta dónde recibió
                return httpx.Response(308, headers={"Range": f"bytes=0-{end}"})
            start = self.requests[
                [r.url.path for r in self.requests].index("/upload/youtube/v3/videos")
            ]
            wanted = json.loads(start.content)["status"]["privacyStatus"]
            return httpx.Response(
                200, json={"id": "vid123", "status": {"privacyStatus": self.privacy or wanted}}
            )
        if request.url.path in ("/upload/youtube/v3/thumbnails/set", "/upload/youtube/v3/captions"):
            return httpx.Response(200, json={})
        if request.url.path == "/youtube/v3/playlistItems":
            return httpx.Response(200, json={})
        return httpx.Response(404, json={"error": {"message": f"no simulado: {url}"}})

    def by_path(self, path):
        return [r for r in self.requests if r.url.path == path]


@pytest.fixture
def google(monkeypatch, client):
    from guionaria_core.services.publishing import youtube

    fake = FakeGoogle()
    monkeypatch.setattr(
        youtube,
        "client_factory",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)),
    )
    settings = client.get("/api/settings").json()
    settings["youtube"] = {"client_id": "cid.apps.googleusercontent.com", "client_secret": "sec"}
    client.put("/api/settings", json=settings)
    return fake


def connect(client, channel_id, no_browser):
    resp = client.post(f"/api/channels/{channel_id}/youtube:connect").json()
    auth = urllib.parse.urlparse(resp["auth_url"])
    params = urllib.parse.parse_qs(auth.query)
    assert no_browser[-1] == resp["auth_url"]  # se abre en el navegador
    assert params["redirect_uri"] == ["http://127.0.0.1:8765/api/youtube/oauth/callback"]
    assert params["code_challenge_method"] == ["S256"] and params["access_type"] == ["offline"]
    assert "youtube.upload" in params["scope"][0]
    page = client.get(
        "/api/youtube/oauth/callback", params={"state": params["state"][0], "code": "codigo"}
    )
    assert page.status_code == 200 and "Casos Reales TV" in page.text


def test_connect_youtube_channel(client, pub_project, channel, google, no_browser):
    assert state_of(client, pub_project["id"])["youtube"]["configured"]
    connect(client, channel["id"], no_browser)
    yt = state_of(client, pub_project["id"])["youtube"]
    assert (yt["connected"], yt["account"]) == (True, "Casos Reales TV")
    assert client.get(f"/api/channels/{channel['id']}/youtube/playlists").json() == [
        {"id": "PL1", "title": "Casos"}
    ]
    # Una redirección vieja o inventada no conecta nada.
    page = client.get("/api/youtube/oauth/callback", params={"state": "otro", "code": "x"})
    assert page.status_code == 400 and "caducó" in page.text
    client.post(f"/api/channels/{channel['id']}/youtube:disconnect")
    assert not state_of(client, pub_project["id"])["youtube"]["connected"]


def test_upload_scheduled_short_with_thumbnail_captions_and_playlist(
    client, pub_project, channel, google, no_browser, fake_claude
):
    from guionaria_core.db import get_engine
    from guionaria_core.models import Project
    from guionaria_core.services.projects import project_dir

    pid = pub_project["id"]
    connect(client, channel["id"], no_browser)
    fake_claude.queue(METADATA)
    wait_job(client, client.post(f"/api/projects/{pid}/publishing:generate").json()["id"])
    yt = state_of(client, pid)["publications"][0]

    # Sin decidir «contenido para niños» no se sube.
    job = wait_job(client, client.post(f"/api/publications/{yt['id']}:upload").json()["id"])
    assert job["status"] == "failed" and "niños" in job["error"]

    with Session(get_engine()) as s:
        folder = project_dir(s.get(Project, pid))
    (folder / "subs").mkdir(parents=True, exist_ok=True)
    (folder / "subs" / "voz.srt").write_text("1\n00:00:00,000 --> 00:00:01,000\nHola\n", "utf-8")
    (folder / "render" / "miniatura.jpg").write_bytes(b"\xff\xd8jpeg")
    when = (datetime.now(UTC) + timedelta(days=1)).replace(microsecond=0)
    client.patch(
        f"/api/publications/{yt['id']}",
        json={"made_for_kids": False, "scheduled_at": when.isoformat(), "playlist_id": "PL1"},
    )
    job = wait_job(client, client.post(f"/api/publications/{yt['id']}:upload").json()["id"])
    assert job["status"] == "done", job["error"]
    assert job["result"]["url"] == "https://youtube.com/shorts/vid123"
    assert job["result"]["scheduled"] is True

    [start] = google.by_path("/upload/youtube/v3/videos")
    assert start.url.params["uploadType"] == "resumable"
    assert start.headers["authorization"] == "Bearer at1"
    body = json.loads(start.content)
    assert body["snippet"]["title"] == "El secuestro que nadie vio"
    assert "Créditos — El secuestro" in body["snippet"]["description"]
    assert body["snippet"]["tags"] == ["caso priscila", "secuestro cdmx", "true crime"]
    assert body["status"]["privacyStatus"] == "private"  # programada: YouTube la publica sola
    assert body["status"]["publishAt"] == when.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    assert body["status"]["selfDeclaredMadeForKids"] is False
    [put] = [r for r in google.requests if str(r.url) == "https://upload.example/sesion"]
    assert put.headers["content-range"] == "bytes 0-20011/20012"  # un solo trozo
    assert google.by_path("/upload/youtube/v3/thumbnails/set")[0].url.params["videoId"] == "vid123"
    assert b"Hola" in google.by_path("/upload/youtube/v3/captions")[0].content
    item = json.loads(google.by_path("/youtube/v3/playlistItems")[0].content)
    assert item["snippet"]["playlistId"] == "PL1"

    state = state_of(client, pid)
    yt = state["publications"][0]
    assert (yt["status"], yt["external_url"]) == ("scheduled", "https://youtube.com/shorts/vid123")
    # TikTok sigue en borrador: el proyecto no pasa a PROGRAMADO hasta que esté todo.
    assert status_of(client, pid) == "RENDERIZADO"


def test_upload_errors_and_private_until_audit(client, pub_project, channel, google, no_browser):
    pid = pub_project["id"]
    connect(client, channel["id"], no_browser)
    yt = state_of(client, pid)["publications"][0]
    client.patch(f"/api/publications/{yt['id']}", json={"made_for_kids": False})

    google.upload_error = "quotaExceeded"
    job = wait_job(client, client.post(f"/api/publications/{yt['id']}:upload").json()["id"])
    assert job["status"] == "failed" and "cuota diaria" in job["error"]
    assert state_of(client, pid)["publications"][0]["status"] == "failed"

    # Proyecto de Google sin auditoría: pidió público y quedó privado.
    google.upload_error = None
    google.privacy = "private"
    job = wait_job(client, client.post(f"/api/publications/{yt['id']}:upload").json()["id"])
    assert job["status"] == "done"
    yt = state_of(client, pid)["publications"][0]
    assert yt["status"] == "published"
    assert "auditoría" in yt["meta"]["warning"]


def test_upload_in_chunks(client, pub_project, channel, google, no_browser, monkeypatch):
    from guionaria_core.services.publishing import youtube

    monkeypatch.setattr(youtube, "CHUNK", 8000)
    connect(client, channel["id"], no_browser)
    yt = state_of(client, pub_project["id"])["publications"][0]
    client.patch(f"/api/publications/{yt['id']}", json={"made_for_kids": False})
    job = wait_job(client, client.post(f"/api/publications/{yt['id']}:upload").json()["id"])
    assert job["status"] == "done", job["error"]
    ranges = [r.headers["content-range"] for r in google.requests if r.url.host == "upload.example"]
    assert ranges == ["bytes 0-7999/20012", "bytes 8000-15999/20012", "bytes 16000-20011/20012"]


def test_mcp_publishing_tools(client, pub_project, fake_claude):
    from tests.test_mcp import Mcp

    mcp = Mcp(client)
    pid = pub_project["id"]
    fake_claude.queue(METADATA)
    job = mcp.call("prepare_publication", project_id=pid)
    assert wait_job(client, job["job_id"])["status"] == "done"
    state = mcp.call("get_publishing", project_id=pid)
    yt, tt = state["publications"]
    assert yt["title"] == "El secuestro que nadie vio"
    state = mcp.call("update_publication", publication_id=tt["id"], changes={"enabled": False})
    assert state["publications"][1]["enabled"] is False
    state = mcp.call("mark_published", publication_id=yt["id"], url="https://youtu.be/zz")
    assert state["publications"][0]["status"] == "published"
    assert status_of(client, pid) == "PUBLICADO"
