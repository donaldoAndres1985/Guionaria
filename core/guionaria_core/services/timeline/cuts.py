"""Transiciones del proyecto: la de por defecto (Ajustes) y la de cada corte (en la escena
que sale)."""

from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from ...config import TransitionPrefs, load_settings, save_settings
from ...models import Project, Scene
from ..errors import DomainError, NotFound
from ..render.transitions import NONE, TRANSITIONS
from .model import build_timeline


class TransitionOption(BaseModel):
    id: str
    label: str


class CutState(BaseModel):
    scene_id: int  # la escena que sale
    position: int
    from_kind: str
    to_kind: str
    at_s: float  # dónde empieza la siguiente escena
    chosen: str | None  # None: usa la de por defecto
    transition: str | None  # la que se aplica (None: corte directo)
    duration_s: float
    chosen_s: float | None = None  # duración propia del corte (None: la de por defecto)


class TransitionsState(BaseModel):
    default: str
    duration: float
    options: list[TransitionOption]
    cuts: list[CutState]


class TransitionsUpdate(BaseModel):
    default: str | None = None
    duration: float | None = Field(default=None, ge=0.2, le=1.5)
    reset_cuts: bool = False  # todos los cortes vuelven a la de por defecto


class CutUpdate(BaseModel):
    transition: str | None = None  # None: la de por defecto; «none»: corte directo
    # Duración propia del corte (None: la de por defecto). Si no se envía, no cambia.
    duration_s: float | None = Field(default=None, ge=0.2, le=2.0)


def _check(kind: str | None) -> None:
    if kind is not None and kind != NONE and kind not in TRANSITIONS:
        raise DomainError(f"Transición desconocida: {kind}")


def transitions_state(session: Session, project: Project) -> TransitionsState:
    prefs = load_settings().transitions
    m = build_timeline(session, project)
    cuts = m.cuts(prefs)
    out = []
    for cut in cuts:
        a, b = m.scenes[cut.index], m.scenes[cut.index + 1]
        if a.scene_id is None:
            continue
        out.append(
            CutState(
                scene_id=a.scene_id,
                position=a.position,
                from_kind=a.kind,
                to_kind=b.kind,
                at_s=round(b.start / m.fps, 3),
                chosen=a.transition,
                transition=cut.transition,
                duration_s=cut.duration,
                chosen_s=a.transition_s,
            )
        )
    return TransitionsState(
        default=prefs.default,
        duration=prefs.duration,
        options=[TransitionOption(id=NONE, label="Corte directo")]
        + [TransitionOption(id=k, label=v) for k, v in TRANSITIONS.items()],
        cuts=out,
    )


def update_transitions(
    session: Session, project: Project, data: TransitionsUpdate
) -> TransitionsState:
    _check(data.default)
    settings = load_settings()
    prefs = settings.transitions.model_dump()
    if data.default is not None:
        prefs["default"] = data.default
    if data.duration is not None:
        prefs["duration"] = data.duration
    settings.transitions = TransitionPrefs(**prefs)
    save_settings(settings)
    if data.reset_cuts:
        for scene in session.exec(select(Scene).where(col(Scene.project_id) == project.id)):
            scene.transition = None
            scene.transition_s = None
        session.commit()
    return transitions_state(session, project)


def set_cut(session: Session, scene_id: int, data: CutUpdate) -> TransitionsState:
    _check(data.transition)
    scene = session.get(Scene, scene_id)
    if scene is None:
        raise NotFound("No existe la escena")
    if "transition" in data.model_fields_set:
        scene.transition = data.transition
    if "duration_s" in data.model_fields_set:
        scene.transition_s = data.duration_s
    session.commit()
    return transitions_state(session, session.get(Project, scene.project_id))
