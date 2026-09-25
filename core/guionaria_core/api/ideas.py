"""Banco de ideas (sección 5.13)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from ..db import get_session
from ..schemas.project import ProjectRead
from ..services import ideas as svc

router = APIRouter(prefix="/api/ideas", tags=["ideas"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("", response_model=list[svc.IdeaRead])
def list_ideas(
    session: SessionDep,
    channel: Annotated[int | None, Query()] = None,
    status: Annotated[svc.IdeaStatus | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> list[svc.IdeaRead]:
    return svc.list_ideas(session, channel, status, q)


@router.post("", response_model=svc.IdeaRead, status_code=status.HTTP_201_CREATED)
def create_idea(data: svc.IdeaCreate, session: SessionDep) -> svc.IdeaRead:
    return svc.create_idea(session, data)


@router.patch("/{idea_id}", response_model=svc.IdeaRead)
def update_idea(idea_id: int, data: svc.IdeaUpdate, session: SessionDep) -> svc.IdeaRead:
    return svc.update_idea(session, idea_id, data)


@router.delete("/{idea_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_idea(idea_id: int, session: SessionDep) -> None:
    svc.delete_idea(session, idea_id)


@router.post("/{idea_id}:convert", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def convert_idea(idea_id: int, data: svc.ConvertRequest, session: SessionDep) -> ProjectRead:
    return svc.convert_idea(session, idea_id, data)
