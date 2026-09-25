"""Voz del proyecto: Piper, voz grabada, Whisper y tiempos reales (sección 5.9)."""

import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session

from ..db import get_engine, get_session
from ..services.errors import DomainError
from ..services.jobs import JobContext, JobRead, jobs
from ..services.projects import get_project
from ..services.voice import models
from ..services.voice import service as voice

router = APIRouter(tags=["voice"])
SessionDep = Annotated[Session, Depends(get_session)]
MAX_UPLOAD = 500 * 1024 * 1024  # 500 MB


class GenerateRequest(BaseModel):
    voice_id: str | None = None  # por defecto: la del canal o la de Ajustes
    speed: float = Field(1.0, ge=0.7, le=1.4)
    pause_s: float = Field(voice.DEFAULT_PAUSE_S, ge=0, le=2)


def _factory() -> Session:
    return Session(get_engine())


@router.get("/api/voice/voices", response_model=list[models.VoiceInfo])
async def list_voices() -> list[models.VoiceInfo]:
    return await models.voice_catalog()


@router.get("/api/projects/{project_id}/voice", response_model=voice.VoiceState)
def get_voice(project_id: int, session: SessionDep) -> voice.VoiceState:
    return voice.voice_state(session, project_id)


@router.post(
    "/api/projects/{project_id}/voice:generate",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def generate(project_id: int, data: GenerateRequest, session: SessionDep) -> JobRead:
    voice._require_ready(session, get_project(session, project_id))

    async def work(ctx: JobContext) -> dict:
        return await voice.generate_voice(
            _factory, project_id, data.voice_id, data.speed, data.pause_s, ctx
        )

    return jobs.submit("voice", work, project_id=project_id, payload={"action": "generate"})


@router.post(
    "/api/projects/{project_id}/voice/segments/{seg_key}:regenerate",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def regenerate_segment(project_id: int, seg_key: str, session: SessionDep) -> JobRead:
    voice._require_ready(session, get_project(session, project_id))

    async def work(ctx: JobContext) -> dict:
        return await voice.generate_voice(
            _factory, project_id, None, 1.0, 0, ctx, only_segment=seg_key
        )

    return jobs.submit(
        "voice", work, project_id=project_id, payload={"action": "regenerate", "seg_key": seg_key}
    )


@router.post("/api/projects/{project_id}/voice:upload", response_model=voice.VoiceState)
async def upload(project_id: int, file: UploadFile, session: SessionDep) -> voice.VoiceState:
    name = Path(file.filename or "voz.wav").name
    if Path(name).suffix.lower() not in voice.AUDIO_EXT:
        raise DomainError("Formato de audio no admitido: usa WAV, MP3, M4A, AAC, OGG o FLAC")
    with tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
        target = Path(tmp) / name
        size = 0
        with target.open("wb") as fh:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise DomainError("El audio supera 500 MB")
                fh.write(chunk)
        return voice.upload_voice(session, project_id, target, name)


@router.post(
    "/api/projects/{project_id}/voice:transcribe",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def transcribe(project_id: int, session: SessionDep) -> JobRead:
    voice._require_ready(session, get_project(session, project_id))

    async def work(ctx: JobContext) -> dict:
        return await voice.transcribe_voice(_factory, project_id, ctx)

    return jobs.submit("voice", work, project_id=project_id, payload={"action": "transcribe"})


@router.get("/api/projects/{project_id}/voice/audio")
def audio(project_id: int, session: SessionDep) -> FileResponse:
    return FileResponse(voice.audio_file(session, project_id))


@router.get("/api/projects/{project_id}/voice/segments/{seg_key}/audio")
def segment_audio(project_id: int, seg_key: str, session: SessionDep) -> FileResponse:
    return FileResponse(voice.audio_file(session, project_id, seg_key))
