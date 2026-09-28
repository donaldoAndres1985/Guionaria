"""Publicación (sección 5.14): metadatos por plataforma, cola y subida a YouTube."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_engine, get_session
from ..schemas.publishing import (
    MarkPublished,
    PublicationUpdate,
    PublishingState,
    QueueItem,
    ThumbnailRequest,
)
from ..services import system
from ..services.channels import get_channel
from ..services.errors import DomainError, NotFound
from ..services.jobs import JobContext, JobRead, jobs
from ..services.llm.claude_cli import get_runner
from ..services.projects import get_project, project_dir
from ..services.publishing import service as svc
from ..services.publishing import youtube

router = APIRouter(tags=["publishing"])
SessionDep = Annotated[Session, Depends(get_session)]


def _factory() -> Session:
    return Session(get_engine())


def _redirect(request: Request) -> str:
    # Google acepta cualquier puerto de 127.0.0.1 para clientes de escritorio.
    return f"http://127.0.0.1:{request.url.port or 8765}{youtube.CALLBACK}"


@router.get("/api/projects/{project_id}/publishing", response_model=PublishingState)
def get_publishing(project_id: int, request: Request, session: SessionDep) -> PublishingState:
    return svc.publishing_state(session, project_id, _redirect(request))


@router.patch("/api/publications/{pub_id}", response_model=PublishingState)
def update_publication(
    pub_id: int, data: PublicationUpdate, session: SessionDep
) -> PublishingState:
    return svc.update_publication(session, pub_id, data)


@router.post("/api/publications/{pub_id}:published", response_model=PublishingState)
def mark_published(pub_id: int, data: MarkPublished, session: SessionDep) -> PublishingState:
    """Publicada a mano: se guarda su dirección y avanza el estado del proyecto."""
    return svc.mark_published(session, pub_id, data.url)


@router.post("/api/publications/{pub_id}:reopen", response_model=PublishingState)
def reopen(pub_id: int, session: SessionDep) -> PublishingState:
    return svc.reopen(session, pub_id)


@router.post(
    "/api/projects/{project_id}/publishing:generate",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def generate(project_id: int, session: SessionDep) -> JobRead:
    """Claude escribe títulos, descripciones, hashtags y comentario fijado (segundo plano)."""
    get_project(session, project_id)
    runner = get_runner()

    async def work(ctx: JobContext) -> dict:
        return await svc.generate_metadata(_factory, project_id, runner, ctx)

    return jobs.submit("publishing_metadata", work, project_id=project_id)


@router.post("/api/projects/{project_id}/publishing/thumbnail", response_model=PublishingState)
def make_thumbnail(project_id: int, data: ThumbnailRequest, session: SessionDep) -> PublishingState:
    return svc.make_cover(session, project_id, data.time_s, data.text)


@router.get("/api/projects/{project_id}/publishing/thumbnail")
def thumbnail(project_id: int, session: SessionDep) -> FileResponse:
    path = svc.cover_path(get_project(session, project_id))
    if not path:
        raise NotFound("Todavía no hay miniatura")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/api/projects/{project_id}/publishing:reveal", status_code=status.HTTP_204_NO_CONTENT)
def reveal(project_id: int, session: SessionDep) -> None:
    """Abre la carpeta publicacion/ (textos por plataforma y miniatura)."""
    project = get_project(session, project_id)
    svc.write_texts(session, project)
    system.reveal(project_dir(project) / svc.FOLDER)


@router.get("/api/publishing/queue", response_model=list[QueueItem])
def get_queue(session: SessionDep, channel_id: int | None = None) -> list[QueueItem]:
    return svc.queue(session, channel_id)


# --- YouTube ---


class ConnectRead(BaseModel):
    auth_url: str


class Playlist(BaseModel):
    id: str
    title: str


@router.post("/api/channels/{channel_id}/youtube:connect", response_model=ConnectRead)
def youtube_connect(channel_id: int, request: Request, session: SessionDep) -> ConnectRead:
    """Abre el inicio de sesión de Google en el navegador; la redirección vuelve al núcleo."""
    get_channel(session, channel_id)
    url = youtube.start_auth(channel_id, _redirect(request))
    system.open_url(url)
    return ConnectRead(auth_url=url)


@router.post(
    "/api/channels/{channel_id}/youtube:disconnect", status_code=status.HTTP_204_NO_CONTENT
)
def youtube_disconnect(channel_id: int) -> None:
    youtube.disconnect(channel_id)


@router.get("/api/channels/{channel_id}/youtube/playlists", response_model=list[Playlist])
async def youtube_playlists(channel_id: int) -> list[Playlist]:
    return [Playlist(**p) for p in await youtube.playlists(channel_id)]


PAGE = """<!doctype html><html lang="es"><meta charset="utf-8"><title>Guionaria</title>
<body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;
height:100vh;margin:0"><div style="text-align:center"><h2>{title}</h2><p>{text}</p></div></body>
</html>"""


@router.get(youtube.CALLBACK, response_class=HTMLResponse)
async def youtube_callback(
    state: str = "", code: str = "", error: str | None = None
) -> HTMLResponse:
    """Redirección de Google tras iniciar sesión."""
    if error or not code:
        body = PAGE.format(title="No se conectó", text="Cancelaste o Google no dio permiso.")
        return HTMLResponse(body, status_code=400)
    try:
        name = await youtube.finish_auth(state, code)
    except DomainError as exc:
        return HTMLResponse(PAGE.format(title="No se conectó", text=exc.message), status_code=400)
    text = f"Canal «{name}» conectado. Ya puedes cerrar esta pestaña y volver a Guionaria."
    return HTMLResponse(PAGE.format(title="Listo", text=text))


@router.post(
    "/api/publications/{pub_id}:upload",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload(pub_id: int, session: SessionDep) -> JobRead:
    """Sube el video a YouTube con sus metadatos (segundo plano, con progreso)."""
    from ..models import Publication

    pub = session.get(Publication, pub_id)
    if not pub:
        raise NotFound("No existe esa publicación")

    async def work(ctx: JobContext) -> dict:
        return await youtube.upload(_factory, pub_id, ctx)

    return jobs.submit(
        "publish", work, project_id=pub.project_id, payload={"publication_id": pub_id}
    )
