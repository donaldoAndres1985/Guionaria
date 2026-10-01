"""Edición del timeline como en CapCut: pistas que se agregan a mano (textos con formato y
efectos de sonido) y el efecto de cada escena.

Las pistas de Guionaria (video, subtítulos, marcadores, SFX y música de las escenas, voz) no
están aquí y no se pueden borrar. Estos cambios no exigen desbloquear las escenas ni los
medios: son del montaje, como el tramo de un video. Se pueden hacer hasta que el video se
programa o se publica.
"""

import json

from sqlmodel import Session, col, select

from ...domain.states import ORDER, ProjectStatus
from ...models import Project, Scene, Sound, TimelineItem, TimelineTrack
from ...models._base import now_iso
from ...schemas.overlay import (
    ItemCreate,
    ItemRead,
    ItemUpdate,
    TextOverlayStyle,
    TrackCreate,
    TrackRead,
    TrackUpdate,
)
from ...schemas.scene import EFFECTS
from ..errors import Conflict, DomainError, NotFound
from ..oplog import log_operation
from ..projects import get_project

TRACK_LABEL = {"text": "Texto", "sfx": "Efectos"}
MAX_TRACKS = 12


def editable_project(session: Session, project_id: int) -> Project:
    project = get_project(session, project_id)
    if ORDER.index(project.status) >= ORDER.index(ProjectStatus.PROGRAMADO):
        raise Conflict("El video ya está programado o publicado: el timeline no se puede cambiar")
    return project


# --- lectura ---


def project_tracks(session: Session, project_id: int) -> list[TimelineTrack]:
    return list(
        session.exec(
            select(TimelineTrack)
            .where(TimelineTrack.project_id == project_id)
            .order_by(col(TimelineTrack.position), col(TimelineTrack.id))
        ).all()
    )


def track_items(session: Session, track_id: int) -> list[TimelineItem]:
    return list(
        session.exec(
            select(TimelineItem)
            .where(TimelineItem.track_id == track_id)
            .order_by(col(TimelineItem.start_s), col(TimelineItem.id))
        ).all()
    )


def item_style(item: TimelineItem) -> TextOverlayStyle | None:
    if not item.style_json:
        return None
    return TextOverlayStyle(**json.loads(item.style_json))


def item_read(session: Session, item: TimelineItem) -> ItemRead:
    sound = session.get(Sound, item.sound_id) if item.sound_id else None
    return ItemRead(
        id=item.id,
        track_id=item.track_id,
        start_s=round(item.start_s, 3),
        duration_s=round(item.duration_s, 3),
        text=item.text,
        style=item_style(item),
        sound_id=item.sound_id,
        sound_title=sound.title if sound else None,
        sound_url=f"/api/sounds/{sound.id}/file" if sound else None,
        sound_duration_s=sound.duration_s if sound else None,
        volume=item.volume,
        fade_in_s=item.fade_in_s,
        fade_out_s=item.fade_out_s,
    )


def track_read(session: Session, track: TimelineTrack) -> TrackRead:
    return TrackRead(
        id=track.id,
        kind=track.kind,
        name=track.name,
        position=track.position,
        items=[item_read(session, i) for i in track_items(session, track.id)],
    )


def list_tracks(session: Session, project_id: int) -> list[TrackRead]:
    return [track_read(session, t) for t in project_tracks(session, project_id)]


def _track(session: Session, track_id: int) -> TimelineTrack:
    track = session.get(TimelineTrack, track_id)
    if not track:
        raise NotFound("La pista no existe")
    return track


def _item(session: Session, item_id: int) -> tuple[TimelineItem, TimelineTrack]:
    item = session.get(TimelineItem, item_id)
    if not item:
        raise NotFound("El elemento no existe")
    return item, _track(session, item.track_id)


# --- pistas ---


def create_track(session: Session, project_id: int, data: TrackCreate) -> TrackRead:
    editable_project(session, project_id)
    tracks = project_tracks(session, project_id)
    if len(tracks) >= MAX_TRACKS:
        raise DomainError(f"Como mucho {MAX_TRACKS} pistas propias por proyecto")
    same = sum(1 for t in tracks if t.kind == data.kind)
    name = (data.name or "").strip() or f"{TRACK_LABEL[data.kind]} {same + 1}"
    track = TimelineTrack(
        project_id=project_id,
        kind=data.kind,
        name=name,
        position=max((t.position for t in tracks), default=0) + 1,
    )
    session.add(track)
    session.flush()
    log_operation(session, "create", "timeline_track", track.id, {"kind": data.kind})
    session.commit()
    return track_read(session, track)


def rename_track(session: Session, track_id: int, data: TrackUpdate) -> TrackRead:
    track = _track(session, track_id)
    editable_project(session, track.project_id)
    track.name = data.name.strip()
    session.commit()
    return track_read(session, track)


def delete_track(session: Session, track_id: int) -> None:
    track = _track(session, track_id)
    editable_project(session, track.project_id)
    items = track_items(session, track_id)
    for item in items:
        session.delete(item)
    session.flush()
    session.delete(track)
    log_operation(session, "delete", "timeline_track", track_id, {"items": len(items)})
    session.commit()


def delete_project_tracks(session: Session, project_id: int) -> None:
    """Al borrar el proyecto de forma definitiva."""
    for track in project_tracks(session, project_id):
        for item in track_items(session, track.id):
            session.delete(item)
        session.flush()
        session.delete(track)
    session.flush()


# --- elementos ---


def _sound(session: Session, sound_id: int | None) -> Sound:
    sound = session.get(Sound, sound_id) if sound_id else None
    if not sound:
        raise DomainError("Elige un efecto de sonido de la biblioteca")
    return sound


def _fit_sound(duration: float, sound: Sound) -> float:
    """Un sonido no se repite: el elemento no dura más que el archivo."""
    if sound.duration_s and duration > sound.duration_s:
        return round(max(sound.duration_s, 0.2), 3)
    return round(duration, 3)


def _clean_text(text: str | None) -> str:
    value = (text or "").strip()
    if not value:
        raise DomainError("Escribe el texto")
    return value


def create_item(session: Session, track_id: int, data: ItemCreate) -> ItemRead:
    track = _track(session, track_id)
    editable_project(session, track.project_id)
    item = TimelineItem(
        track_id=track_id,
        start_s=round(data.start_s, 3),
        duration_s=round(data.duration_s, 3),
        volume=data.volume,
        fade_in_s=data.fade_in_s,
        fade_out_s=data.fade_out_s,
    )
    if track.kind == "text":
        item.text = _clean_text(data.text)
        item.style_json = (data.style or TextOverlayStyle()).model_dump_json()
    else:
        sound = _sound(session, data.sound_id)
        item.sound_id = sound.id
        item.duration_s = _fit_sound(data.duration_s, sound)
    session.add(item)
    session.flush()
    log_operation(session, "create", "timeline_item", item.id, {"track": track_id})
    session.commit()
    return item_read(session, item)


def update_item(session: Session, item_id: int, data: ItemUpdate) -> ItemRead:
    item, track = _item(session, item_id)
    editable_project(session, track.project_id)
    fields = data.model_fields_set
    if "track_id" in fields and data.track_id is not None and data.track_id != track.id:
        target = _track(session, data.track_id)
        if target.project_id != track.project_id or target.kind != track.kind:
            raise DomainError("Solo se puede mover a otra pista del mismo tipo")
        item.track_id = target.id
        track = target
    if "start_s" in fields and data.start_s is not None:
        item.start_s = round(data.start_s, 3)
    if "duration_s" in fields and data.duration_s is not None:
        item.duration_s = round(data.duration_s, 3)
    if track.kind == "text":
        if "text" in fields:
            item.text = _clean_text(data.text)
        if "style" in fields and data.style is not None:
            item.style_json = data.style.model_dump_json()
    else:
        if "sound_id" in fields:
            item.sound_id = _sound(session, data.sound_id).id
        for name in ("volume", "fade_in_s", "fade_out_s"):
            if name in fields and getattr(data, name) is not None:
                setattr(item, name, getattr(data, name))
        item.duration_s = _fit_sound(item.duration_s, _sound(session, item.sound_id))
    session.commit()
    return item_read(session, item)


def delete_item(session: Session, item_id: int) -> None:
    item, track = _item(session, item_id)
    editable_project(session, track.project_id)
    session.delete(item)
    log_operation(session, "delete", "timeline_item", item_id, {"track": track.id})
    session.commit()


def duplicate_item(session: Session, item_id: int) -> ItemRead:
    """Copia justo a continuación del original, en la misma pista."""
    item, track = _item(session, item_id)
    editable_project(session, track.project_id)
    copy = TimelineItem(
        **item.model_dump(exclude={"id", "created_at", "start_s"}),
        start_s=round(item.start_s + item.duration_s, 3),
        created_at=now_iso(),
    )
    session.add(copy)
    session.flush()
    log_operation(session, "create", "timeline_item", copy.id, {"from": item_id})
    session.commit()
    return item_read(session, copy)


# --- efecto de cada escena ---


def set_effect(session: Session, scene_id: int, effect: str) -> Scene:
    scene = session.get(Scene, scene_id)
    if not scene:
        raise NotFound("La escena no existe")
    if effect not in EFFECTS:
        raise DomainError(f"Efecto desconocido: {effect}")
    editable_project(session, scene.project_id)
    scene.effect = effect
    log_operation(session, "update", "scene", scene_id, {"effect": effect})
    session.commit()
    return scene
