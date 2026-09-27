"""Render automático con FFmpeg (sección 16)."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_engine, get_session
from ..services.jobs import JobContext, JobRead, jobs
from ..services.projects import get_project
from ..services.render import plan
from ..services.render import service as render

router = APIRouter(tags=["render"])
SessionDep = Annotated[Session, Depends(get_session)]


class RenderRequest(BaseModel):
    draft: bool = False  # borrador a 720p (compatibilidad: usa `quality`)
    quality: plan.Level | None = None  # draft | standard | high | max
    burn_subtitles: bool | None = None  # por defecto: sí en reels, no en videos


@router.get("/api/projects/{project_id}/render", response_model=render.RenderState)
def get_render(project_id: int, session: SessionDep) -> render.RenderState:
    return render.render_state(session, project_id)


@router.post(
    "/api/projects/{project_id}/render",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_render(project_id: int, data: RenderRequest, session: SessionDep) -> JobRead:
    get_project(session, project_id)
    level = data.quality or ("draft" if data.draft else "standard")

    async def work(ctx: JobContext) -> dict:
        return await render.render_project(
            lambda: Session(get_engine()), project_id, level, data.burn_subtitles, ctx
        )

    return jobs.submit(
        "render", work, project_id=project_id, payload={"quality": level, "draft": level == "draft"}
    )


@router.get("/api/projects/{project_id}/render/files/{name}")
def render_file(project_id: int, name: str, session: SessionDep) -> FileResponse:
    return FileResponse(render.render_file(session, project_id, name))
