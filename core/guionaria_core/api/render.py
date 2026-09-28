"""Render automático con FFmpeg (sección 16)."""

import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session

from ..config import SubtitleStyle, TextStyle, VideoLook
from ..db import get_engine, get_session
from ..services.jobs import JobContext, JobRead, jobs
from ..services.projects import get_project
from ..services.render import look as looks
from ..services.render import plan
from ..services.render import service as render

router = APIRouter(tags=["render"])
SessionDep = Annotated[Session, Depends(get_session)]


class RenderRequest(BaseModel):
    draft: bool = False  # borrador a 720p (compatibilidad: usa `quality`)
    quality: plan.Level | None = None  # draft | standard | high | max
    subtitle_style: SubtitleStyle | None = None  # por defecto: el último usado
    text_style: TextStyle | None = None  # texto en pantalla; por defecto: el último usado
    look: VideoLook | None = None  # look del video (clip de ajuste); por defecto: el último
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
            lambda: Session(get_engine()),
            project_id,
            level,
            data.burn_subtitles,
            ctx,
            style=data.subtitle_style,
            text_style=data.text_style,
            look=data.look,
        )

    return jobs.submit(
        "render", work, project_id=project_id, payload={"quality": level, "draft": level == "draft"}
    )


@router.get("/api/projects/{project_id}/render/files/{name}")
def render_file(project_id: int, name: str, session: SessionDep) -> FileResponse:
    return FileResponse(render.render_file(session, project_id, name))


class LutsRead(BaseModel):
    luts: list[str]
    imported: str | None = None


@router.get("/api/looks/luts", response_model=LutsRead)
def list_luts() -> LutsRead:
    return LutsRead(luts=looks.list_luts())


@router.post("/api/looks/luts:upload", response_model=LutsRead)
async def upload_lut(file: UploadFile) -> LutsRead:
    """Importa un LUT .cube (se guarda en la carpeta luts/ de Guionaria)."""
    name = Path(file.filename or "lut.cube").name
    with tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
        target = Path(tmp) / "subido.cube"
        data = await file.read(50 * 1024 * 1024 + 1)
        if len(data) > 50 * 1024 * 1024:
            raise looks.DomainError("El LUT supera 50 MB")
        target.write_bytes(data)
        imported = looks.import_lut(target, name)
    return LutsRead(luts=looks.list_luts(), imported=imported)
