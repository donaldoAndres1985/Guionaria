"""Historial de operaciones, papelera y registro de derechos (sección 5.15)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..schemas.project import ProjectRead
from ..services import history, rights, trash
from ..services.projects import read_project

router = APIRouter(tags=["history"])
SessionDep = Annotated[Session, Depends(get_session)]


class ExportedFile(BaseModel):
    path: str


@router.get("/api/history", response_model=history.HistoryPage)
def list_history(
    session: SessionDep,
    actor: history.Actor | None = None,
    group: str | None = None,
    project: int | None = None,
    before: int | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> history.HistoryPage:
    return history.list_history(
        session, actor=actor, group=group, project_id=project, before=before, limit=limit
    )


@router.get("/api/trash", response_model=list[trash.TrashItem])
def list_trash(session: SessionDep) -> list[trash.TrashItem]:
    return trash.list_trash(session)


@router.post("/api/trash/{project_id}:restore", response_model=ProjectRead)
def restore(project_id: int, session: SessionDep) -> ProjectRead:
    project = trash.restore_project(session, project_id)
    return read_project(session, project.id)


@router.delete("/api/trash/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def purge(project_id: int, session: SessionDep) -> None:
    trash.purge_project(session, project_id)


@router.post("/api/trash:empty")
def empty(session: SessionDep) -> dict[str, int]:
    return {"purged": trash.empty_trash(session)}


@router.get("/api/projects/{project_id}/rights", response_model=rights.RightsReport)
def rights_report(project_id: int, session: SessionDep) -> rights.RightsReport:
    return rights.rights_report(session, project_id)


@router.post("/api/projects/{project_id}/rights:export", response_model=ExportedFile)
def export_rights(project_id: int, session: SessionDep) -> ExportedFile:
    return ExportedFile(path=rights.export_rights(session, project_id))
