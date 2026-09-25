"""Biblioteca global de medios (sección 5.11)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..schemas.media import SceneMediaRead
from ..services import library as svc

router = APIRouter(prefix="/api/library", tags=["library"])
SessionDep = Annotated[Session, Depends(get_session)]


class ReuseRequest(BaseModel):
    scene_id: int


@router.get("", response_model=svc.LibraryPage)
def list_library(
    session: SessionDep,
    kind: str | None = None,
    channel: int | None = None,
    project: int | None = None,
    provider: str | None = None,
    license: str | None = None,
    orientation: str | None = None,
    usage: svc.Usage | None = None,
    duplicates: bool = False,
    q: str | None = None,
    sort: svc.Sort = "recent",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 60,
) -> svc.LibraryPage:
    return svc.list_library(
        session,
        kind=kind,
        channel_id=channel,
        project_id=project,
        provider=provider,
        license=license,
        orientation=orientation,
        usage=usage,
        duplicates=duplicates,
        q=q,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.get("/stats", response_model=svc.LibraryStats)
def stats(session: SessionDep) -> svc.LibraryStats:
    return svc.library_stats(session)


@router.post("/{asset_id}:reuse", response_model=SceneMediaRead)
def reuse(asset_id: int, data: ReuseRequest, session: SessionDep) -> SceneMediaRead:
    return svc.reuse_asset(session, asset_id, data.scene_id)
