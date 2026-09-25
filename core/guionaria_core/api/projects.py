from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from ..db import get_session
from ..domain.states import ProjectStatus
from ..schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from ..services import projects as svc

router = APIRouter(prefix="/api/projects", tags=["projects"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("", response_model=list[ProjectRead])
def list_projects(
    session: SessionDep,
    channel: Annotated[int | None, Query()] = None,
    status: Annotated[ProjectStatus | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> list[ProjectRead]:
    return svc.list_projects(session, channel_id=channel, status=status, q=q)


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(data: ProjectCreate, session: SessionDep) -> ProjectRead:
    return svc.create_project(session, data)


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, session: SessionDep) -> ProjectRead:
    return svc.read_project(session, project_id)


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(project_id: int, data: ProjectUpdate, session: SessionDep) -> ProjectRead:
    return svc.update_project(session, project_id, data)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, session: SessionDep) -> None:
    svc.delete_project(session, project_id)
