"""Timeline del proyecto y exportación a OTIO, FCPXML y EDL (sección 5.10)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..schemas.overlay import (
    EffectUpdate,
    ItemCreate,
    ItemRead,
    ItemUpdate,
    TrackCreate,
    TrackRead,
    TrackUpdate,
)
from ..services import background
from ..services.projects import get_project
from ..services.timeline import cuts, overlays, preview
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


@router.get("/api/projects/{project_id}/background", response_model=background.BackgroundRead)
def get_background(project_id: int, session: SessionDep) -> background.BackgroundRead:
    return background.background_state(session, project_id)


@router.put("/api/projects/{project_id}/background", response_model=background.BackgroundRead)
def put_background(
    project_id: int, data: background.BackgroundSet, session: SessionDep
) -> background.BackgroundRead:
    """Audio de fondo en bucle (sound_id de la biblioteca y volumen %); sound_id null: quitar."""
    return background.set_background(session, project_id, data)


# --- edición del timeline: pistas manuales (textos y SFX) y efecto de cada escena ---


@router.get("/api/projects/{project_id}/overlay-tracks", response_model=list[TrackRead])
def get_tracks(project_id: int, session: SessionDep) -> list[TrackRead]:
    get_project(session, project_id)
    return overlays.list_tracks(session, project_id)


@router.post("/api/projects/{project_id}/overlay-tracks", response_model=TrackRead)
def post_track(project_id: int, data: TrackCreate, session: SessionDep) -> TrackRead:
    return overlays.create_track(session, project_id, data)


@router.patch("/api/overlay-tracks/{track_id}", response_model=TrackRead)
def patch_track(track_id: int, data: TrackUpdate, session: SessionDep) -> TrackRead:
    return overlays.rename_track(session, track_id, data)


@router.delete("/api/overlay-tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_track(track_id: int, session: SessionDep) -> Response:
    """Borra una pista agregada a mano con todo lo que tiene (las de Guionaria no están aquí)."""
    overlays.delete_track(session, track_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/overlay-tracks/{track_id}/items", response_model=ItemRead)
def post_item(track_id: int, data: ItemCreate, session: SessionDep) -> ItemRead:
    return overlays.create_item(session, track_id, data)


@router.patch("/api/overlay-items/{item_id}", response_model=ItemRead)
def patch_item(item_id: int, data: ItemUpdate, session: SessionDep) -> ItemRead:
    return overlays.update_item(session, item_id, data)


@router.delete("/api/overlay-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item(item_id: int, session: SessionDep) -> Response:
    overlays.delete_item(session, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/overlay-items/{item_id}:duplicate", response_model=ItemRead)
def duplicate(item_id: int, session: SessionDep) -> ItemRead:
    return overlays.duplicate_item(session, item_id)


class EffectState(BaseModel):
    scene_id: int
    effect: str | None


@router.put("/api/scenes/{scene_id}/effect", response_model=EffectState)
def put_effect(scene_id: int, data: EffectUpdate, session: SessionDep) -> EffectState:
    """Efecto de la escena desde el timeline, sin desbloquear las escenas."""
    scene = overlays.set_effect(session, scene_id, data.effect)
    return EffectState(scene_id=scene.id, effect=scene.effect)
