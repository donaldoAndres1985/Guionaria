from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from ..db import get_engine, get_session
from ..schemas.script import (
    RewriteRequest,
    RewriteResult,
    ScriptRead,
    ScriptSave,
    UnlockResult,
    VersionSummary,
)
from ..services import script as svc
from ..services.jobs import JobContext, JobRead, jobs
from ..services.llm.claude_cli import get_runner
from ..services.projects import get_project

router = APIRouter(prefix="/api/projects/{project_id}/script", tags=["script"])
SessionDep = Annotated[Session, Depends(get_session)]


def _session_factory() -> Session:
    return Session(get_engine())


@router.post(":generate", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
async def generate(project_id: int, session: SessionDep) -> JobRead:
    get_project(session, project_id)  # 404 antes de encolar
    runner = get_runner()

    async def work(ctx: JobContext) -> dict:
        return await svc.generate_script(_session_factory, project_id, runner, ctx)

    return jobs.submit("generate_script", work, project_id=project_id)


@router.get("", response_model=ScriptRead)
def get_script(
    project_id: int, session: SessionDep, version: Annotated[int | None, Query()] = None
) -> ScriptRead:
    return svc.read_script(session, project_id, version)


@router.put("", response_model=ScriptRead)
def save_script(project_id: int, data: ScriptSave, session: SessionDep) -> ScriptRead:
    return svc.save_script(session, project_id, data.segments)


@router.get("/versions", response_model=list[VersionSummary])
def list_versions(project_id: int, session: SessionDep) -> list[VersionSummary]:
    return svc.list_versions(session, project_id)


@router.post("/versions/{version}:restore", response_model=ScriptRead)
def restore_version(project_id: int, version: int, session: SessionDep) -> ScriptRead:
    return svc.restore_version(session, project_id, version)


@router.post("/segments/{seg_key}:rewrite", response_model=RewriteResult)
async def rewrite(
    project_id: int, seg_key: str, data: RewriteRequest, session: SessionDep
) -> RewriteResult:
    return await svc.rewrite_fragment(
        session, project_id, seg_key, data.instruccion, data.fragmento, get_runner()
    )


@router.post(":approve", response_model=ScriptRead)
def approve(project_id: int, session: SessionDep) -> ScriptRead:
    return svc.approve_script(session, project_id)


@router.post(":unlock", response_model=UnlockResult)
def unlock(project_id: int, session: SessionDep) -> UnlockResult:
    return svc.unlock_script(session, project_id)
