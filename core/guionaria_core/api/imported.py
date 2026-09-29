"""Videos terminados en otro editor (CapCut…): importarlos a un canal y gestionarlos desde
Publicación."""

import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Form, UploadFile, status
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_engine, get_session
from ..schemas.project import ProjectRead
from ..services import imported
from ..services.errors import DomainError
from ..services.jobs import JobContext, JobRead, jobs
from ..services.projects import get_project, read_project

router = APIRouter(tags=["imported"])
SessionDep = Annotated[Session, Depends(get_session)]
MAX_UPLOAD = 20 * 1024 * 1024 * 1024  # 20 GB


class ImportResult(BaseModel):
    project: ProjectRead
    job: JobRead | None  # transcripción con Whisper (si se pidió)


class TranscriptRead(BaseModel):
    text: str | None


def _factory() -> Session:
    return Session(get_engine())


async def _save(file: UploadFile, folder: Path) -> Path:
    """Guarda la subida por trozos (los videos pesan cientos de MB)."""
    name = Path(file.filename or "video.mp4").name
    if Path(name).suffix.lower() not in imported.VIDEO_EXT:
        raise DomainError("Formato no admitido: usa MP4, MOV, M4V, MKV o WebM")
    target = folder / name
    size = 0
    with target.open("wb") as fh:
        while chunk := await file.read(8 * 1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD:
                raise DomainError("El video supera 20 GB")
            fh.write(chunk)
    return target


def _transcribe_job(project_id: int) -> JobRead:
    async def work(ctx: JobContext) -> dict:
        return await imported.transcribe_video(_factory, project_id, ctx)

    return jobs.submit("transcribe_video", work, project_id=project_id)


@router.post(
    "/api/channels/{channel_id}/projects:import-video",
    response_model=ImportResult,
    status_code=status.HTTP_201_CREATED,
)
async def import_video(
    channel_id: int,
    file: UploadFile,
    session: SessionDep,
    title: Annotated[str, Form()] = "",
    notes: Annotated[str | None, Form()] = None,
    target_publish_at: Annotated[str | None, Form()] = None,
    transcribe: Annotated[bool, Form()] = True,
) -> ImportResult:
    """Crea un proyecto «importado» con el video terminado, listo para Publicación."""
    with tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
        source = await _save(file, Path(tmp))
        project = imported.import_video(
            session, channel_id, source, title or source.stem, notes, target_publish_at
        )
    job = _transcribe_job(project.id) if transcribe else None
    return ImportResult(project=read_project(session, project.id), job=job)


@router.post("/api/projects/{project_id}/video:replace", response_model=ImportResult)
async def replace_video(
    project_id: int,
    file: UploadFile,
    session: SessionDep,
    transcribe: Annotated[bool, Form()] = True,
) -> ImportResult:
    """Nueva versión del video terminado (otra exportación)."""
    get_project(session, project_id)
    with tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
        source = await _save(file, Path(tmp))
        imported.replace_video(session, project_id, source)
    job = _transcribe_job(project_id) if transcribe else None
    return ImportResult(project=read_project(session, project_id), job=job)


@router.post(
    "/api/projects/{project_id}:transcribe-video",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def transcribe(project_id: int, session: SessionDep) -> JobRead:
    """Whisper transcribe el audio del video (para que Claude escriba los textos)."""
    get_project(session, project_id)
    return _transcribe_job(project_id)


@router.get("/api/projects/{project_id}/transcript", response_model=TranscriptRead)
def transcript(project_id: int, session: SessionDep) -> TranscriptRead:
    return TranscriptRead(text=imported.read_transcript(get_project(session, project_id)))
