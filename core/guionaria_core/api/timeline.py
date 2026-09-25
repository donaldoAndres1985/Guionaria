"""Timeline del proyecto y exportación a OTIO, FCPXML y EDL (sección 5.10)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..services.timeline import service as timeline

router = APIRouter(tags=["timeline"])
SessionDep = Annotated[Session, Depends(get_session)]


class ExportRequest(BaseModel):
    formats: list[timeline.Format] | None = None  # por defecto, los tres


@router.get("/api/projects/{project_id}/timeline", response_model=timeline.TimelineState)
def get_timeline(project_id: int, session: SessionDep) -> timeline.TimelineState:
    return timeline.timeline_state(session, project_id)


@router.post("/api/projects/{project_id}/timeline:export", response_model=timeline.ExportResult)
def export(project_id: int, data: ExportRequest, session: SessionDep) -> timeline.ExportResult:
    return timeline.export_timeline(session, project_id, data.formats)
