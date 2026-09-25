"""Almacenamiento: espacio por canal, proyecto y tipo, y limpieza (sección 5.11)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session

from ..db import get_session
from ..services import storage as svc

router = APIRouter(prefix="/api/storage", tags=["storage"])
SessionDep = Annotated[Session, Depends(get_session)]


class CleanupRequest(BaseModel):
    project_ids: list[int] = Field(min_length=1)


@router.get("/usage", response_model=svc.StorageUsage)
def usage(session: SessionDep) -> svc.StorageUsage:
    return svc.storage_usage(session)


@router.get("/cleanup", response_model=svc.CleanupPreview)
def cleanup_preview(session: SessionDep) -> svc.CleanupPreview:
    return svc.cleanup_preview(session)


@router.post("/cleanup", response_model=svc.CleanupResult)
def cleanup(data: CleanupRequest, session: SessionDep) -> svc.CleanupResult:
    return svc.cleanup_candidates(session, data.project_ids)
