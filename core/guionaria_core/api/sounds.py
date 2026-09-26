"""SFX y música (sección 5.12): biblioteca, Freesound y sonidos de cada escena."""

import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Form, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session

from ..db import get_session
from ..services import sounds as svc
from ..services.errors import DomainError

router = APIRouter(tags=["sounds"])
SessionDep = Annotated[Session, Depends(get_session)]
MAX_UPLOAD = 300 * 1024 * 1024


class ImportRequest(BaseModel):
    paths: list[str] = Field(min_length=1)
    kind: svc.Kind = "sfx"
    tags: list[str] = []


class SaveFreesoundRequest(BaseModel):
    result: svc.FreesoundResult
    kind: svc.Kind = "sfx"


class AssignRequest(BaseModel):
    role: svc.Kind
    sound_id: int | None


@router.get("/api/sounds", response_model=list[svc.SoundRead])
def list_sounds(
    session: SessionDep,
    kind: svc.Kind | None = None,
    q: str | None = None,
    tag: str | None = None,
    mood: str | None = None,
) -> list[svc.SoundRead]:
    return svc.list_sounds(session, kind, q, tag, mood)


@router.get("/api/sounds/tags", response_model=list[svc.TagCount])
def tags(session: SessionDep, kind: svc.Kind | None = None) -> list[svc.TagCount]:
    return svc.tag_counts(session, kind)


@router.post("/api/sounds:import", response_model=list[svc.SoundRead])
def import_sounds(data: ImportRequest, session: SessionDep) -> list[svc.SoundRead]:
    return svc.import_files(session, [Path(p) for p in data.paths], data.kind, data.tags)


@router.post("/api/sounds:upload", response_model=list[svc.SoundRead])
async def upload(
    session: SessionDep, file: UploadFile, kind: Annotated[svc.Kind, Form()] = "sfx"
) -> list[svc.SoundRead]:
    name = Path(file.filename or "sonido.wav").name
    if Path(name).suffix.lower() not in svc.AUDIO_EXT:
        raise DomainError("Formato de audio no admitido: usa WAV, MP3, OGG, FLAC, M4A o AAC")
    with tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
        target = Path(tmp) / name
        size = 0
        with target.open("wb") as fh:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise DomainError("El archivo supera 300 MB")
                fh.write(chunk)
        return svc.import_files(session, [target], kind)


@router.patch("/api/sounds/{sound_id}", response_model=svc.SoundRead)
def update(sound_id: int, data: svc.SoundUpdate, session: SessionDep) -> svc.SoundRead:
    return svc.update_sound(session, sound_id, data)


@router.delete("/api/sounds/{sound_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(sound_id: int, session: SessionDep) -> None:
    svc.delete_sound(session, sound_id)


@router.get("/api/sounds/{sound_id}/file")
def sound_file(sound_id: int, session: SessionDep) -> FileResponse:
    return FileResponse(svc.sound_file(session, sound_id))


@router.get("/api/freesound/search", response_model=svc.FreesoundPage)
async def search_freesound(
    session: SessionDep, q: str, page: int = 1, max_duration: float | None = None
) -> svc.FreesoundPage:
    return await svc.search_freesound(session, q, page, max_duration)


@router.post("/api/freesound:save", response_model=svc.SoundRead)
async def save_freesound(data: SaveFreesoundRequest, session: SessionDep) -> svc.SoundRead:
    return await svc.save_freesound(session, data.result, data.kind)


@router.get("/api/scenes/{scene_id}/sounds", response_model=svc.SceneSounds)
def scene_sounds(scene_id: int, session: SessionDep) -> svc.SceneSounds:
    from ..services.scenes import get_scene

    return svc.scene_sounds(session, get_scene(session, scene_id))


@router.put("/api/scenes/{scene_id}/sounds", response_model=svc.SceneSounds)
def assign(scene_id: int, data: AssignRequest, session: SessionDep) -> svc.SceneSounds:
    return svc.assign_sound(session, scene_id, data.role, data.sound_id)


@router.get("/api/scenes/{scene_id}/sounds/suggestions", response_model=list[svc.SoundRead])
def suggestions(scene_id: int, role: svc.Kind, session: SessionDep) -> list[svc.SoundRead]:
    return svc.suggestions(session, scene_id, role)
