from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..domain.states import ProjectStatus
from ..schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from ..services import projects as svc
from ..services.jobs import JobRead

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


class StatusRequest(BaseModel):
    status: ProjectStatus


@router.post("/{project_id}/research", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
async def research_project(project_id: int, session: SessionDep) -> JobRead:
    """Claude busca en internet y guarda una ficha con fuentes en el proyecto (segundo plano)."""
    from ..db import get_engine
    from ..services import research
    from ..services.jobs import JobContext, jobs
    from ..services.llm.claude_cli import get_runner

    svc.get_project(session, project_id)
    runner = get_runner()

    async def work(ctx: JobContext) -> dict:
        return await research.research_project(
            lambda: Session(get_engine()), project_id, runner, ctx
        )

    return jobs.submit("research", work, project_id=project_id)


@router.post("/{project_id}:set-status", response_model=ProjectRead)
def set_status(project_id: int, data: StatusRequest, session: SessionDep) -> ProjectRead:
    """Etapas finales que se hacen fuera de la app (render, programación, publicación)."""
    return svc.set_manual_status(session, project_id, data.status)
