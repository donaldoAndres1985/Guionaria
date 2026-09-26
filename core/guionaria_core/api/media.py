from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_engine, get_session
from ..schemas.media import (
    ApproveRequest,
    DownloadRequest,
    MediaOverview,
    SceneMediaRead,
    SearchRequest,
    SearchResult,
    SelectRequest,
    SuggestResult,
)
from ..services.errors import DomainError
from ..services.jobs import JobContext, JobRead, jobs
from ..services.llm.claude_cli import get_runner
from ..services.media import framing
from ..services.media import service as svc

router = APIRouter(tags=["media"])
SessionDep = Annotated[Session, Depends(get_session)]


def _session_factory() -> Session:
    return Session(get_engine())


@router.get("/api/projects/{project_id}/media", response_model=MediaOverview)
def overview(project_id: int, session: SessionDep) -> MediaOverview:
    return svc.media_overview(session, project_id)


@router.post("/api/projects/{project_id}/media:approve", response_model=MediaOverview)
def approve_media(project_id: int, session: SessionDep) -> MediaOverview:
    return svc.approve_media(session, project_id)


@router.post("/api/projects/{project_id}/media:unlock", response_model=MediaOverview)
def unlock_media(project_id: int, session: SessionDep) -> MediaOverview:
    return svc.unlock_media(session, project_id)


@router.post(
    "/api/projects/{project_id}/media:download-selected",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def download_selected(project_id: int, session: SessionDep) -> JobRead:
    """Descarga lo elegido en todas las escenas y aprueba el primero de cada una."""
    if not svc.media_overview(session, project_id).editable:
        raise DomainError("Los medios están aprobados: desbloquéalos para cambiarlos")

    async def work(ctx: JobContext) -> dict:
        return await svc.download_selected(_session_factory, project_id, ctx)

    return jobs.submit("download_selected", work, project_id=project_id)


@router.put(
    "/api/scenes/{scene_id}/candidates/{candidate_id}/selected", response_model=SceneMediaRead
)
def select_candidate(
    scene_id: int, candidate_id: int, data: SelectRequest, session: SessionDep
) -> SceneMediaRead:
    return svc.select_candidate(session, scene_id, candidate_id, data.selected)


@router.get("/api/scenes/{scene_id}/media", response_model=SceneMediaRead)
def scene_media(scene_id: int, session: SessionDep) -> SceneMediaRead:
    return svc.scene_media(session, scene_id)


@router.post("/api/scenes/{scene_id}/search", response_model=SearchResult)
async def search(scene_id: int, data: SearchRequest, session: SessionDep) -> SearchResult:
    return await svc.search_scene(session, scene_id, data)


@router.post("/api/scenes/{scene_id}/queries:suggest", response_model=SuggestResult)
async def suggest(scene_id: int, session: SessionDep) -> SuggestResult:
    return await svc.suggest_queries(session, scene_id, get_runner())


@router.post(
    "/api/scenes/{scene_id}/candidates:download",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def download(scene_id: int, data: DownloadRequest, session: SessionDep) -> JobRead:
    scene = svc.get_scene(session, scene_id)

    async def work(ctx: JobContext) -> dict:
        return await svc.download_candidates(_session_factory, scene_id, data.candidate_ids, ctx)

    # No exclusivo: se pueden encolar descargas de varias escenas a la vez.
    return jobs.submit(
        "download_media",
        work,
        project_id=scene.project_id,
        payload={"scene_id": scene_id, "candidates": data.candidate_ids},
        exclusive=False,
    )


@router.post("/api/scenes/{scene_id}/assets/{asset_id}:approve", response_model=SceneMediaRead)
def approve_asset(
    scene_id: int, asset_id: int, session: SessionDep, data: ApproveRequest | None = None
) -> SceneMediaRead:
    return svc.approve_asset(session, scene_id, asset_id, (data or ApproveRequest()).role)


@router.post("/api/scenes/{scene_id}/assets/{asset_id}:unapprove", response_model=SceneMediaRead)
def unapprove_asset(scene_id: int, asset_id: int, session: SessionDep) -> SceneMediaRead:
    return svc.unapprove_asset(session, scene_id, asset_id)


@router.get("/api/assets/{asset_id}/file")
def asset_file(asset_id: int, session: SessionDep) -> FileResponse:
    return FileResponse(svc.asset_file(session, asset_id))


@router.get("/api/assets/{asset_id}/thumb")
def asset_thumb(asset_id: int, session: SessionDep) -> FileResponse:
    return FileResponse(svc.asset_file(session, asset_id, thumb=True))


# --- encuadre y recorte de tiempo (sección 5.6) ---


class FramingSaved(BaseModel):
    framing: framing.FramingRead
    job: JobRead | None  # videos con encuadre: se codifican en segundo plano


@router.get("/api/scenes/{scene_id}/assets/{asset_id}/framing", response_model=framing.FramingRead)
def get_framing(scene_id: int, asset_id: int, session: SessionDep) -> framing.FramingRead:
    return framing.get_framing(session, scene_id, asset_id)


@router.put("/api/scenes/{scene_id}/assets/{asset_id}/framing", response_model=FramingSaved)
async def save_framing(
    scene_id: int, asset_id: int, data: framing.FramingIn, session: SessionDep
) -> FramingSaved:
    state, pending = framing.save_framing(session, scene_id, asset_id, data)
    job = None
    if pending:

        async def work(ctx: JobContext) -> dict:
            return await framing.render_framed_video(_session_factory, scene_id, asset_id, ctx)

        scene = svc.get_scene(session, scene_id)
        job = jobs.submit(
            "frame_media",
            work,
            project_id=scene.project_id,
            payload={"scene_id": scene_id, "asset_id": asset_id},
            exclusive=False,
        )
    return FramingSaved(framing=state, job=job)


@router.get("/api/scenes/{scene_id}/assets/{asset_id}/approved-file")
def approved_file(scene_id: int, asset_id: int, session: SessionDep) -> FileResponse:
    """La copia aprobada (encuadrada, si tiene encuadre), no el original."""
    return FileResponse(svc.approved_file(session, scene_id, asset_id))
