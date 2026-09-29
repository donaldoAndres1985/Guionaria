"""Audio de fondo en bucle (sección 5.12): un tema de la biblioteca que se repite durante todo
el video, con su volumen, fundidos y bajando cuando habla la voz. Pensado para los videos
tranquilos (religiosos, reflexiones): reemplaza la música por escena."""

import json

from pydantic import BaseModel, Field
from sqlmodel import Session

from ..config import get_paths
from ..models import Project, Sound
from ..models._base import now_iso
from .errors import DomainError
from .projects import get_project

DEFAULT_VOLUME = 35  # % (igual que la música por escena)


class BackgroundSet(BaseModel):
    sound_id: int | None = None  # None: quitar el audio de fondo
    volume: int = Field(DEFAULT_VOLUME, ge=0, le=150)  # %


class BackgroundRead(BaseModel):
    sound_id: int | None
    volume: int
    title: str | None = None
    duration_s: float | None = None
    file_url: str | None = None
    attribution: str | None = None
    missing: bool = False  # el sonido ya no está en la biblioteca


def _data(project: Project) -> dict:
    return json.loads(project.background_json) if project.background_json else {}


def background_state(session: Session, project_id: int) -> BackgroundRead:
    project = get_project(session, project_id)
    data = _data(project)
    sound_id = data.get("sound_id")
    volume = int(data.get("volume", DEFAULT_VOLUME))
    if not sound_id:
        return BackgroundRead(sound_id=None, volume=volume)
    sound = session.get(Sound, sound_id)
    if sound is None:
        return BackgroundRead(sound_id=sound_id, volume=volume, missing=True)
    return BackgroundRead(
        sound_id=sound.id,
        volume=volume,
        title=sound.title,
        duration_s=sound.duration_s,
        file_url=f"/api/sounds/{sound.id}/file",
        attribution=sound.attribution,
    )


def set_background(session: Session, project_id: int, data: BackgroundSet) -> BackgroundRead:
    project = get_project(session, project_id)
    if data.sound_id is not None and session.get(Sound, data.sound_id) is None:
        raise DomainError("Ese audio no está en la biblioteca")
    project.background_json = (
        json.dumps({"sound_id": data.sound_id, "volume": data.volume})
        if data.sound_id is not None
        else None
    )
    project.updated_at = now_iso()
    session.commit()
    return background_state(session, project_id)


def background_sound(session: Session, project: Project) -> Sound | None:
    sound_id = _data(project).get("sound_id")
    return session.get(Sound, sound_id) if sound_id else None


def background_clip(session: Session, project: Project, total: int, warnings: list[str]):
    """La pista del timeline: desde el inicio hasta el final, en bucle y con su volumen."""
    from .timeline.model import Clip

    sound = background_sound(session, project)
    if sound is None:
        return None
    path = get_paths().home / sound.file_path
    if not path.exists():
        warnings.append(f"Falta el archivo del audio de fondo «{sound.title}»")
        return None
    volume = int(_data(project).get("volume", DEFAULT_VOLUME)) / 100
    return Clip(path.name, path, "audio", 0, max(total, 1), 0, None, None, sound.id, True, volume)
