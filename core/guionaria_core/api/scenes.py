from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from ..db import get_engine, get_session
from ..schemas.scene import (
    ExportResult,
    GenerateScenesRequest,
    ReorderRequest,
    SceneRead,
    ScenesRead,
    SceneUpdate,
)
from ..services import scenes as svc
from ..services.jobs import JobContext, JobRead, jobs
from ..services.llm.claude_cli import get_runner
from ..services.projects import get_project

router = APIRouter(tags=["scenes"])
SessionDep = Annotated[Session, Depends(get_session)]
PROJECT = "/api/projects/{project_id}/scenes"


def _session_factory() -> Session:
    return Session(get_engine())


@router.post(PROJECT + ":generate", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
async def generate(
    project_id: int, session: SessionDep, data: GenerateScenesRequest | None = None
) -> JobRead:
    get_project(session, project_id)
    mode = (data or GenerateScenesRequest()).mode
    runner = get_runner()

    async def work(ctx: JobContext) -> dict:
        return await svc.generate_scenes(_session_factory, project_id, mode, runner, ctx)

    return jobs.submit("generate_scenes", work, project_id=project_id, payload={"mode": mode})


@router.get(PROJECT, response_model=ScenesRead)
def list_scenes(project_id: int, session: SessionDep) -> ScenesRead:
    return svc.list_scenes(session, project_id)


@router.post(PROJECT + ":reorder", response_model=ScenesRead)
def reorder(project_id: int, data: ReorderRequest, session: SessionDep) -> ScenesRead:
    return svc.reorder_scenes(session, project_id, data.scene_ids)


@router.post(PROJECT + ":approve", response_model=ScenesRead)
def approve(project_id: int, session: SessionDep) -> ScenesRead:
    return svc.approve_scenes(session, project_id)


@router.post(PROJECT + ":unlock", response_model=ScenesRead)
def unlock(project_id: int, session: SessionDep) -> ScenesRead:
    return svc.unlock_scenes(session, project_id)


@router.post(PROJECT + ":export", response_model=ExportResult)
def export(
    project_id: int,
    session: SessionDep,
    format: Annotated[Literal["md", "csv"], Query()] = "md",
) -> ExportResult:
    return svc.export_scenes(session, project_id, format)


@router.patch("/api/scenes/{scene_id}", response_model=SceneRead)
def update_scene(scene_id: int, data: SceneUpdate, session: SessionDep) -> SceneRead:
    return svc.update_scene(session, scene_id, data)


@router.post("/api/scenes/{scene_id}:reviewed", response_model=SceneRead)
def mark_reviewed(scene_id: int, session: SessionDep) -> SceneRead:
    return svc.mark_reviewed(session, scene_id)


@router.post("/api/scenes/{scene_id}:split", response_model=ScenesRead)
def split(scene_id: int, session: SessionDep) -> ScenesRead:
    return svc.split_scene(session, scene_id)


@router.post("/api/scenes/{scene_id}:duplicate", response_model=ScenesRead)
def duplicate(scene_id: int, session: SessionDep) -> ScenesRead:
    return svc.duplicate_scene(session, scene_id)


@router.delete("/api/scenes/{scene_id}", response_model=ScenesRead)
def delete(scene_id: int, session: SessionDep) -> ScenesRead:
    return svc.delete_scene(session, scene_id)
