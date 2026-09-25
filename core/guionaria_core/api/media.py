from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import FileResponse
from sqlmodel import Session

from ..db import get_engine, get_session
from ..schemas.media import (
    ApproveRequest,
    DownloadRequest,
    MediaOverview,
    SceneMediaRead,
    SearchRequest,
    SearchResult,
    SuggestResult,
)
from ..services.jobs import JobContext, JobRead, jobs
from ..services.llm.claude_cli import get_runner
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
