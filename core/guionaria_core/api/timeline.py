"""Timeline del proyecto y exportación a OTIO, FCPXML y EDL (sección 5.10)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..services.projects import get_project
from ..services.timeline import cuts, preview
from ..services.timeline import service as timeline

router = APIRouter(tags=["timeline"])
SessionDep = Annotated[Session, Depends(get_session)]


class ExportRequest(BaseModel):
    formats: list[timeline.Format] | None = None  # por defecto, los tres


@router.get("/api/projects/{project_id}/timeline/preview", response_model=preview.PreviewState)
def get_preview(project_id: int, session: SessionDep) -> preview.PreviewState:
    """Receta de la vista previa en vivo (escenas, audio, subtítulos) sin renderizar."""
    return preview.preview_state(session, get_project(session, project_id))


@router.get("/api/projects/{project_id}/timeline", response_model=timeline.TimelineState)
def get_timeline(project_id: int, session: SessionDep) -> timeline.TimelineState:
    return timeline.timeline_state(session, project_id)


@router.post("/api/projects/{project_id}/timeline:export", response_model=timeline.ExportResult)
def export(project_id: int, data: ExportRequest, session: SessionDep) -> timeline.ExportResult:
    return timeline.export_timeline(session, project_id, data.formats)


@router.get("/api/projects/{project_id}/transitions", response_model=cuts.TransitionsState)
def get_transitions(project_id: int, session: SessionDep) -> cuts.TransitionsState:
    return cuts.transitions_state(session, get_project(session, project_id))


@router.put("/api/projects/{project_id}/transitions", response_model=cuts.TransitionsState)
def put_transitions(
    project_id: int, data: cuts.TransitionsUpdate, session: SessionDep
) -> cuts.TransitionsState:
    return cuts.update_transitions(session, get_project(session, project_id), data)


@router.put("/api/scenes/{scene_id}/transition", response_model=cuts.TransitionsState)
def put_cut(scene_id: int, data: cuts.CutUpdate, session: SessionDep) -> cuts.TransitionsState:
    """Transición del corte entre esta escena y la siguiente."""
    return cuts.set_cut(session, scene_id, data)
