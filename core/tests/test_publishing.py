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


# --- títulos con gancho y miniatura diseñada por Claude ---

TITLES = {
    "titulos": [
        {
            "titulo": "36 días creyendo que fue un accidente",
            "gancho": "Cifra concreta",
            "por_que": "Dato real.",
        },
        {"titulo": "¿Quién movió el cuerpo?", "gancho": "Pregunta abierta", "por_que": "Intriga."},
        {
            "titulo": "La autopsia lo cambió todo",
            "gancho": "Giro",
            "por_que": "Promete revelación.",
        },
    ]
}


def test_titles_follow_the_hook_guide(client, pub_project, fake_claude):
    pid = pub_project["id"]
    yt = state_of(client, pid)["publications"][0]
    fake_claude.queue(TITLES)
    job = client.post(f"/api/publications/{yt['id']}:titles").json()
    assert wait_job(client, job["id"])["status"] == "done"
    prompt = fake_claude.calls[0]["prompt"]
    assert "Guía de títulos con gancho" in prompt and "Contradicción" in prompt
    assert "8 títulos" in prompt and "YouTube" in prompt
    ideas = state_of(client, pid)["publications"][0]["meta"]["title_ideas"]
    assert ideas[0] == {
        "title": "36 días creyendo que fue un accidente",
        "hook": "Cifra concreta",
        "why": "Dato real.",
    }
    # Los metadatos de todas las plataformas también siguen la guía.
    fake_claude.queue(METADATA)
    wait_job(client, client.post(f"/api/projects/{pid}/publishing:generate").json()["id"])
    assert "Guía de títulos con gancho" in fake_claude.calls[1]["prompt"]


def test_guide_is_added_to_an_old_copy_of_the_prompt(client, pub_project, fake_claude, home):
    # Un metadatos_publicacion.md copiado antes de existir la guía no tiene {guia_titulos}.
    prompt_file = home / "config" / "prompts" / "metadatos_publicacion.md"
    prompt_file.write_text("Escribe metadatos para {plataformas}.", encoding="utf-8")
    fake_claude.queue(METADATA)
    wait_job(
        client, client.post(f"/api/projects/{pub_project['id']}/publishing:generate").json()["id"]
    )
    assert "Guía de títulos con gancho" in fake_claude.calls[0]["prompt"]


BASE_DESIGN = {"cuadro": 1, "color": "#FFD400", "foco_x": 0.4, "foco_y": 0.3, "por_que": "Rostro."}
DESIGNS = {
    "disenos": [
        {**BASE_DESIGN, "plantilla": "impacto", "texto": "¿Un accidente?", "resaltar": "accidente",
         "etiqueta": "Caso real"},
        {**BASE_DESIGN, "plantilla": "expediente", "texto": "Nadie vio nada", "resaltar": "nada",
         "etiqueta": None},
    ]
}  # fmt: skip


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere FFmpeg")
def test_claude_designs_thumbnails_from_real_frames(client, media_project, web, fake_claude):
    from io import BytesIO

    from PIL import Image

    from tests.media_support import downloaded

    pid = media_project["id"]
    image_scene = media_project["scenes"][1]
    [asset, *_] = downloaded(client, image_scene)
    client.post(f"/api/scenes/{image_scene}/assets/{asset['id']}:approve")

    bad = {"disenos": [{**DESIGNS["disenos"][0], "cuadro": 9}]}
    fake_claude.queue(bad, DESIGNS)  # el primero pide un cuadro que no existe: se reintenta
    job = client.post(f"/api/projects/{pid}/publishing/cover:design").json()
    done = wait_job(client, job["id"], timeout=60)
    assert done["status"] == "done", done["error"]
    call, retry = fake_claude.calls[-2:]  # antes: guion y escenas del proyecto de prueba
    assert call["tools"] == ["Read"]  # Claude mira los cuadros
    assert (call["cwd"] / "cuadro_01.jpg").exists()
    assert "cuadro_01.jpg" in call["prompt"] and "MÍRALOS" in call["prompt"]
    assert "Cuadros inexistentes: [9]" in retry["prompt"]

    options = state_of(client, pid)["cover_options"]
    assert [o["index"] for o in options] == [1, 2]
    assert options[0]["design"]["plantilla"] == "impacto"
    img = Image.open(BytesIO(client.get(options[0]["url"]).content))
    assert img.size == (1080, 1920)  # reel

    # Cambiar el texto de una propuesta y elegirla como miniatura.
    design = {**options[1]["design"], "texto": "Silencio total", "plantilla": "documental"}
    state = client.post(
        f"/api/projects/{pid}/publishing/cover:redraw", json={"index": 2, "design": design}
    ).json()
    assert state["cover_options"][1]["design"]["texto"] == "Silencio total"
    state = client.post(f"/api/projects/{pid}/publishing/cover:choose", json={"index": 2}).json()
    yt = state["publications"][0]
    assert yt["thumbnail_url"] and yt["meta"]["thumbnail_text"] == "Silencio total"
    chosen = Image.open(BytesIO(client.get(yt["thumbnail_url"]).content))
    assert chosen.size == (1080, 1920)


def test_thumbnail_design_needs_media(client, pub_project, fake_claude):
    job = client.post(f"/api/projects/{pub_project['id']}/publishing/cover:design").json()
    done = wait_job(client, job["id"])
    assert done["status"] == "failed" and "Aprueba los medios" in done["error"]


def test_tape_text_is_readable_on_any_accent():
    from PIL import Image

    from guionaria_core.schemas.publishing import DisenoClaude
    from guionaria_core.services.publishing.cover import render

    frame = Image.new("RGB", (800, 600), (90, 110, 120))
    for color, want in (("#E53935", (255, 212, 0)), ("#FFD400", (229, 57, 53))):
        design = DisenoClaude(
            cuadro=1,
            plantilla="expediente",
            texto="A puertas cerradas",
            resaltar="cerradas",
            color=color,
        )
        img = render(design, frame, (1280, 720))
        pixels = img.get_flattened_data()
        # El resaltado usa un color distinto al de la cinta (si no, rojo sobre rojo no se ve).
        near = sum(1 for p in pixels if all(abs(a - b) < 40 for a, b in zip(p, want, strict=True)))
        assert near > 300, color


def test_upload_own_thumbnail(client, pub_project):
    from io import BytesIO

    from PIL import Image

    pid = pub_project["id"]
    buf = BytesIO()
    Image.new("RGB", (1600, 900), (200, 30, 30)).save(buf, "PNG")  # 16:9 en un reel
    resp = client.post(
        f"/api/projects/{pid}/publishing/thumbnail:upload",
        files={"file": ("mi_miniatura.png", buf.getvalue(), "image/png")},
    )
    assert resp.status_code == 200, resp.text
    url = resp.json()["publications"][0]["thumbnail_url"]
    got = client.get(url)
    assert got.headers["content-type"] == "image/jpeg" and len(got.content) <= 2 * 1024 * 1024
    assert Image.open(BytesIO(got.content)).size == (1080, 1920)  # encuadrada al reel
    bad = client.post(
        f"/api/projects/{pid}/publishing/thumbnail:upload",
        files={"file": ("x.png", b"no es imagen", "image/png")},
    )
    assert bad.status_code == 400 and "imagen válida" in bad.json()["detail"]


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere FFmpeg")
def test_mcp_chat_claude_looks_at_frames_and_draws(client, media_project, web):
    from tests.media_support import downloaded
    from tests.test_mcp import Mcp

    pid = media_project["id"]
    image_scene = media_project["scenes"][1]
    [asset, *_] = downloaded(client, image_scene)
    client.post(f"/api/scenes/{image_scene}/assets/{asset['id']}:approve")
    mcp = Mcp(client)

    def content(name, **args):
        body = mcp.rpc("tools/call", {"name": name, "arguments": args}).json()["result"]
        assert not body.get("isError"), body
        return body["content"]

    frames = content("get_thumbnail_frames", project_id=pid)
    assert frames[0]["type"] == "text" and "draw_thumbnails" in frames[0]["text"]
    images = [c for c in frames if c["type"] == "image"]
    assert len(images) == 1 and images[0]["mimeType"] == "image/jpeg"

    design = {
        **BASE_DESIGN,
        "plantilla": "impacto",
        "texto": "¿Un accidente?",
        "resaltar": "accidente",
    }
    drawn = content(
        "draw_thumbnails", project_id=pid, designs=[design, {**design, "plantilla": "documental"}]
    )
    assert [c["type"] for c in drawn].count("image") == 2  # las ve para revisarlas
    assert [o["index"] for o in state_of(client, pid)["cover_options"]] == [1, 2]
    body = mcp.rpc(
        "tools/call",
        {
            "name": "draw_thumbnails",
            "arguments": {"project_id": pid, "designs": [{**design, "cuadro": 7}]},
        },
    ).json()["result"]
    assert body["isError"] and "Cuadros inexistentes" in body["content"][0]["text"]
    state = mcp.call("choose_thumbnail", project_id=pid, index=2)
    assert state["publications"][0]["thumbnail_url"]


def test_mcp_title_guide(client):
    from tests.test_mcp import Mcp

    assert "Tipos de gancho" in Mcp(client).call("get_title_guide")
