"""YouTube Data API v3: conectar un canal (OAuth de app de escritorio) y subir el video con sus
metadatos, fecha programada, miniatura, subtítulos y playlist.

- OAuth «App de escritorio» con redirección a 127.0.0.1 (el propio núcleo recibe el código) y
  PKCE. Cada usuario crea gratis su cliente en Google Cloud (Ajustes → Publicación).
- Los accesos de cada canal de Guionaria se guardan en config/youtube.json (fuera del repo).
- Cuota gratuita: unas 10 000 unidades al día; subir un video gasta 1600 (unas 6 al día).
- Mientras el proyecto de Google no pase la auditoría, YouTube deja los videos en privado.
"""

import base64
import hashlib
import json
import secrets
import time
import urllib.parse
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import httpx

from ...config import get_paths, load_settings
from ...models._base import now_iso
from ..errors import Conflict, DomainError
from ..jobs import JobContext
from ..oplog import log_operation

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/youtube/v3"
UPLOAD = "https://www.googleapis.com/upload/youtube/v3"
SCOPES = " ".join(
    [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.force-ssl",  # subtítulos y playlists
    ]
)
CHUNK = 8 * 1024 * 1024
CALLBACK = "/api/youtube/oauth/callback"

# Pruebas: se reemplaza por un cliente con MockTransport.
client_factory: Callable[[], httpx.AsyncClient] = lambda: httpx.AsyncClient(  # noqa: E731
    timeout=httpx.Timeout(120.0, connect=15.0)
)
# state → datos del inicio de sesión en curso (se recibe en la redirección).
_pending: dict[str, dict] = {}

REASONS = {
    "quotaExceeded": "Se acabó la cuota diaria gratuita de YouTube (unas 6 subidas al día). "
    "Vuelve a intentarlo mañana.",
    "uploadLimitExceeded": "YouTube no deja subir más videos hoy desde este canal.",
    "youtubeSignupRequired": "La cuenta de Google no tiene canal de YouTube: créalo primero.",
    "insufficientPermissions": "Falta el permiso para subir: vuelve a conectar el canal.",
    "forbidden": "YouTube rechazó la operación con esta cuenta.",
    "invalidTitle": "YouTube no acepta el título (¿vacío o con caracteres < >?).",
    "invalidDescription": "YouTube no acepta la descripción (¿caracteres < >?).",
    "invalidTags": "YouTube no acepta alguna etiqueta.",
    "invalidPublishAt": "La fecha programada no es válida (debe ser futura).",
}


def _tokens_file() -> Path:
    return get_paths().config_dir / "youtube.json"


def _load() -> dict:
    path = _tokens_file()
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _save(data: dict) -> None:
    path = _tokens_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def configured() -> bool:
    app = load_settings().youtube
    return bool(app.client_id.strip() and app.client_secret.strip())


def is_connected(channel_id: int) -> bool:
    return bool(_load().get(str(channel_id), {}).get("refresh_token"))


def account_name(channel_id: int) -> str | None:
    return _load().get(str(channel_id), {}).get("title")


def disconnect(channel_id: int) -> None:
    data = _load()
    data.pop(str(channel_id), None)
    _save(data)


def _error(resp: httpx.Response, action: str) -> DomainError:
    try:
        body = resp.json()
    except ValueError:
        body = {}
    err = body.get("error")
    if isinstance(err, str):  # errores de OAuth: {"error": "invalid_grant", ...}
        if err == "invalid_grant":
            return DomainError(
                "Google ya no acepta el acceso: vuelve a conectar el canal de YouTube"
            )
        return DomainError(f"Google rechazó {action}: {body.get('error_description') or err}")
    reasons = [e.get("reason") for e in (err or {}).get("errors", [])]
    for reason in reasons:
        if reason in REASONS:
            return DomainError(REASONS[reason])
    message = (err or {}).get("message") or resp.text[:200]
    return DomainError(f"YouTube rechazó {action} ({resp.status_code}): {message}")


# --- conectar ---


def start_auth(channel_id: int, redirect_uri: str) -> str:
    """URL de inicio de sesión de Google para conectar el canal (se abre en el navegador)."""
    if not configured():
        raise DomainError(
            "Primero pega el ID y el secreto de cliente de Google (Ajustes de YouTube)"
        )
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    state = secrets.token_urlsafe(16)
    _pending[state] = {
        "channel_id": channel_id,
        "verifier": verifier,
        "redirect_uri": redirect_uri,
        "at": time.time(),
    }
    params = {
        "client_id": load_settings().youtube.client_id.strip(),
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",  # para recibir siempre el refresh_token
        "state": state,
        "code_challenge": challenge.decode(),
        "code_challenge_method": "S256",
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


async def finish_auth(state: str, code: str) -> str:
    """Recibe la redirección de Google: cambia el código por los accesos y guarda el canal."""
    pending = _pending.pop(state, None)
    if not pending or time.time() - pending["at"] > 900:
        raise DomainError("El inicio de sesión caducó: vuelve a pulsar «Conectar YouTube»")
    app = load_settings().youtube
    async with client_factory() as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": app.client_id.strip(),
                "client_secret": app.client_secret.strip(),
                "redirect_uri": pending["redirect_uri"],
                "grant_type": "authorization_code",
                "code_verifier": pending["verifier"],
            },
        )
        if resp.status_code != 200:
            raise _error(resp, "el inicio de sesión")
        tokens = resp.json()
        if not tokens.get("refresh_token"):
            raise DomainError(
                "Google no dio acceso permanente: vuelve a conectar y acepta los permisos"
            )
        me = await client.get(
            f"{API}/channels",
            params={"part": "snippet", "mine": "true"},
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        if me.status_code != 200:
            raise _error(me, "la lectura del canal")
        items = me.json().get("items", [])
        if not items:
            raise DomainError("Esa cuenta de Google no tiene canal de YouTube")
    data = _load()
    data[str(pending["channel_id"])] = {
        "refresh_token": tokens["refresh_token"],
        "access_token": tokens["access_token"],
        "expires_at": time.time() + int(tokens.get("expires_in", 3600)),
        "youtube_channel_id": items[0]["id"],
        "title": items[0]["snippet"]["title"],
        "connected_at": now_iso(),
    }
    _save(data)
    return items[0]["snippet"]["title"]


async def _token(client: httpx.AsyncClient, channel_id: int) -> str:
    data = _load()
    entry = data.get(str(channel_id))
    if not entry or not entry.get("refresh_token"):
        raise Conflict("Conecta el canal de YouTube primero")
    if entry.get("access_token") and entry.get("expires_at", 0) - 60 > time.time():
        return entry["access_token"]
    app = load_settings().youtube
    resp = await client.post(
        TOKEN_URL,
        data={
            "client_id": app.client_id.strip(),
            "client_secret": app.client_secret.strip(),
            "refresh_token": entry["refresh_token"],
            "grant_type": "refresh_token",
        },
    )
    if resp.status_code != 200:
        raise _error(resp, "renovar el acceso")
    fresh = resp.json()
    entry["access_token"] = fresh["access_token"]
    entry["expires_at"] = time.time() + int(fresh.get("expires_in", 3600))
    _save(data)
    return entry["access_token"]


async def playlists(channel_id: int) -> list[dict]:
    async with client_factory() as client:
        token = await _token(client, channel_id)
        resp = await client.get(
            f"{API}/playlists",
            params={"part": "snippet", "mine": "true", "maxResults": 50},
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            raise _error(resp, "la lista de playlists")
    return [{"id": p["id"], "title": p["snippet"]["title"]} for p in resp.json().get("items", [])]


# --- subir ---


def video_body(pub, meta, description: str, language: str, now: datetime | None = None) -> dict:
    """Metadatos de videos.insert. Con fecha futura sube en privado y YouTube la publica sola."""
    if meta.made_for_kids is None:
        raise DomainError("Indica si es contenido para niños (obligatorio en YouTube)")
    status: dict = {
        "privacyStatus": pub.visibility or "public",
        "selfDeclaredMadeForKids": meta.made_for_kids,
        "containsSyntheticMedia": meta.synthetic,
        "embeddable": True,
    }
    if pub.scheduled_at:
        when = datetime.fromisoformat(pub.scheduled_at).astimezone(UTC)
        if when > (now or datetime.now(UTC)):
            status["privacyStatus"] = "private"
            status["publishAt"] = when.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return {
        "snippet": {
            "title": pub.title,
            "description": description,
            "tags": json.loads(pub.tags or "[]"),
            "categoryId": meta.category_id,
            "defaultLanguage": language,
            "defaultAudioLanguage": language,
        },
        "status": status,
    }


def _multipart(meta: dict, content: bytes, content_type: str) -> tuple[bytes, str]:
    boundary = "guionaria" + secrets.token_hex(8)
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
        + json.dumps(meta).encode()
        + f"\r\n--{boundary}\r\nContent-Type: {content_type}\r\n\r\n".encode()
        + content
        + f"\r\n--{boundary}--\r\n".encode()
    )
    return body, f"multipart/related; boundary={boundary}"


async def _send_file(client, token: str, session_url: str, video: Path, ctx: JobContext) -> dict:
    total = video.stat().st_size
    sent = 0
    with video.open("rb") as fh:
        while True:
            chunk = fh.read(CHUNK)
            end = sent + len(chunk) - 1
            resp = await client.put(
                session_url,
                content=chunk,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {sent}-{end}/{total}",
                },
            )
            if resp.status_code in (200, 201):
                return resp.json()
            if resp.status_code != 308:
                raise _error(resp, "la subida")
            # 308: YouTube indica hasta dónde recibió («Range: bytes=0-N»).
            got = resp.headers.get("Range")
            sent = int(got.split("-")[1]) + 1 if got else end + 1
            fh.seek(sent)
            ctx.progress(0.05 + 0.8 * sent / total, f"Subiendo a YouTube… {sent * 100 // total} %")


async def upload(session_factory, pub_id: int, ctx: JobContext) -> dict:
    from ...models import Publication
    from ..channels import get_channel
    from ..projects import get_project
    from ..rights import rights_report
    from . import service

    with session_factory() as session:
        pub = session.get(Publication, pub_id)
        if not pub or pub.platform != "youtube":
            raise DomainError("Esta publicación no es de YouTube")
        if pub.status == "published" and pub.external_id:
            raise Conflict("Ya está subida a YouTube")
        project = get_project(session, pub.project_id)
        channel = get_channel(session, project.channel_id)
        video = service.final_video(project)
        if not video.exists():
            raise Conflict("Renderiza el video final antes de subirlo")
        meta = service._meta(pub)
        credits = rights_report(session, project.id).credits
        body = video_body(
            pub, meta, service.full_text(pub, credits, project.format), channel.language
        )
        cover = service.cover_path(project)
        srt = service.subtitles_file(project)
        is_short = project.format == "reel"
        channel_id, language = channel.id, channel.language
        pub.status, pub.error = "uploading", None
        session.commit()

    warnings: list[str] = []
    try:
        async with client_factory() as client:
            token = await _token(client, channel_id)
            ctx.progress(0.03, "Preparando la subida a YouTube…")
            start = await client.post(
                f"{UPLOAD}/videos",
                params={"uploadType": "resumable", "part": "snippet,status"},
                json=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Upload-Content-Type": "video/mp4",
                    "X-Upload-Content-Length": str(video.stat().st_size),
                },
            )
            if start.status_code != 200 or "Location" not in start.headers:
                raise _error(start, "la subida")
            done = await _send_file(client, token, start.headers["Location"], video, ctx)
            video_id = done["id"]
            auth = {"Authorization": f"Bearer {token}"}

            if cover:
                ctx.progress(0.88, "Subiendo la miniatura…")
                resp = await client.post(
                    f"{UPLOAD}/thumbnails/set",
                    params={"videoId": video_id},
                    content=cover.read_bytes(),
                    headers={**auth, "Content-Type": "image/jpeg"},
                )
                if resp.status_code != 200:
                    warnings.append(
                        "La miniatura no se subió (YouTube pide verificar el canal con el "
                        "teléfono para usar miniaturas propias)."
                    )
            if meta.captions and srt.exists():
                ctx.progress(0.92, "Subiendo los subtítulos…")
                content, ctype = _multipart(
                    {"snippet": {"videoId": video_id, "language": language, "name": ""}},
                    srt.read_bytes(),
                    "application/octet-stream",
                )
                resp = await client.post(
                    f"{UPLOAD}/captions",
                    params={"uploadType": "multipart", "part": "snippet"},
                    content=content,
                    headers={**auth, "Content-Type": ctype},
                )
                if resp.status_code != 200:
                    warnings.append("Los subtítulos no se subieron: súbelos en YouTube Studio.")
            if meta.playlist_id:
                resp = await client.post(
                    f"{API}/playlistItems",
                    params={"part": "snippet"},
                    json={
                        "snippet": {
                            "playlistId": meta.playlist_id,
                            "resourceId": {"kind": "youtube#video", "videoId": video_id},
                        }
                    },
                    headers=auth,
                )
                if resp.status_code != 200:
                    warnings.append("No se pudo agregar a la playlist.")
    except (DomainError, httpx.HTTPError) as exc:
        message = (
            exc.message if isinstance(exc, DomainError) else f"Sin conexión con YouTube ({exc})"
        )
        with session_factory() as session:
            pub = session.get(Publication, pub_id)
            pub.status, pub.error = "failed", message
            session.commit()
        raise DomainError(message) from exc

    got_privacy = done.get("status", {}).get("privacyStatus")
    scheduled = "publishAt" in body["status"]
    if not scheduled and body["status"]["privacyStatus"] != "private" and got_privacy == "private":
        warnings.append(
            "YouTube la dejó en privado: tu proyecto de Google aún no pasó la auditoría. "
            "Cámbiala a pública en YouTube Studio."
        )
    with session_factory() as session:
        pub = session.get(Publication, pub_id)
        meta = service._meta(pub)
        meta.warning = " ".join(warnings) or None
        service._set_meta(pub, meta)
        pub.external_id = video_id
        url = (
            f"https://youtube.com/shorts/{video_id}" if is_short else f"https://youtu.be/{video_id}"
        )
        pub.external_url = url
        pub.account = account_name(channel_id)
        pub.status = "scheduled" if scheduled else "published"
        pub.published_at = None if scheduled else now_iso()
        pub.error = None
        pub.updated_at = now_iso()
        session.commit()
        project = get_project(session, pub.project_id)
        log_operation(
            session,
            "publish",
            "project",
            project.id,
            {"platform": "youtube", "video_id": video_id, "scheduled": scheduled},
            actor="system",
        )
        service.sync_project_status(session, project)
        session.commit()
    return {
        "video_id": video_id,
        "url": url,
        "scheduled": scheduled,
        "privacy": got_privacy,
        "warnings": warnings,
    }
