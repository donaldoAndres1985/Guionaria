"""Timeline del proyecto: vista previa y exportación al editor (sección 5.10)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session

from ...domain.states import ORDER, ProjectStatus
from ...models import Project
from ...models._base import now_iso
from ...util.paths import check_path_length
from ..errors import Conflict
from ..oplog import log_operation
from ..package import export_package
from ..projects import get_project, project_dir
from .model import build_timeline
from .writers import to_edl, to_fcpxml, to_otio

Format = Literal["otio", "fcpxml", "edl"]
FORMATS: tuple[Format, ...] = ("otio", "fcpxml", "edl")
WRITERS = {"otio": to_otio, "fcpxml": to_fcpxml, "edl": to_edl}
FILE_NAME = "proyecto"


class TimelineScene(BaseModel):
    position: int
    kind: str
    start_s: float
    duration_s: float
    clip_duration_s: float | None  # None: sin medio (hueco en la pista de video)
    file_name: str | None
    thumb_url: str | None
    text: str | None


class TimelineMarker(BaseModel):
    time_s: float
    name: str
    note: str
    color: str


class TimelineSound(BaseModel):
    name: str
    start_s: float
    duration_s: float
    scene_position: int | None


class TimelineFile(BaseModel):
    format: Format
    file: str
    updated_at: str


class TimelineState(BaseModel):
    project_id: int
    can_export: bool
    reason: str | None
    fps: int
    width: int
    height: int
    duration_s: float
    has_voice: bool
    voice_duration_s: float | None
    scenes: list[TimelineScene]
    markers: list[TimelineMarker]
    sfx: list[TimelineSound]
    music: list[TimelineSound]
    warnings: list[str]
    folder: str
    exports: list[TimelineFile]


class ExportResult(BaseModel):
    folder: str
    files: list[str]
    warnings: list[str]
    state: TimelineState


def _reason(project: Project) -> str | None:
    if ORDER.index(project.status) < ORDER.index(ProjectStatus.MEDIOS_APROBADOS):
        return "Aprueba los medios antes de exportar el timeline"
    return None


def _exports(project: Project) -> list[TimelineFile]:
    folder = project_dir(project) / "timeline"
    out = []
    for fmt in FORMATS:
        path = folder / f"{FILE_NAME}.{fmt}"
        if path.exists():
            stamp = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
            out.append(TimelineFile(format=fmt, file=path.name, updated_at=stamp))
    return out


def _sound(c, sec) -> TimelineSound:
    return TimelineSound(
        name=c.name,
        start_s=sec(c.start),
        duration_s=sec(c.duration),
        scene_position=c.scene_position,
    )


def timeline_state(session: Session, project_id: int) -> TimelineState:
    project = get_project(session, project_id)
    m = build_timeline(session, project)
    sec = lambda f: round(f / m.fps, 3)  # noqa: E731
    return TimelineState(
        project_id=project_id,
        can_export=_reason(project) is None and bool(m.scenes),
        reason=_reason(project) or (None if m.scenes else "El proyecto no tiene escenas"),
        fps=m.fps,
        width=m.width,
        height=m.height,
        duration_s=sec(m.duration),
        has_voice=m.voice is not None,
        voice_duration_s=sec(m.voice.duration) if m.voice else None,
        scenes=[
            TimelineScene(
                position=s.position,
                kind=s.kind,
                start_s=sec(s.start),
                duration_s=sec(s.duration),
                clip_duration_s=sec(s.clip.duration) if s.clip else None,
                file_name=s.clip.name if s.clip else None,
                thumb_url=f"/api/assets/{s.asset_id}/thumb" if s.clip and s.asset_id else None,
                text=s.text,
            )
            for s in m.scenes
        ],
        markers=[
            TimelineMarker(time_s=sec(mk.frame), name=mk.name, note=mk.note, color=mk.color)
            for mk in m.markers
        ],
        sfx=[_sound(c, sec) for c in m.sfx],
        music=[_sound(c, sec) for c in m.music],
        warnings=m.warnings,
        folder=str(project_dir(project) / "timeline"),
        exports=_exports(project),
    )


def export_timeline(
    session: Session, project_id: int, formats: list[Format] | None = None
) -> ExportResult:
    project = get_project(session, project_id)
    reason = _reason(project)
    if reason:
        raise Conflict(reason)
    m = build_timeline(session, project)
    if not m.scenes:
        raise Conflict("El proyecto no tiene escenas")

    folder = project_dir(project) / "timeline"
    folder.mkdir(parents=True, exist_ok=True)
    files = []
    for fmt in formats or FORMATS:
        path = folder / f"{FILE_NAME}.{fmt}"
        check_path_length(path)
        path.write_text(WRITERS[fmt](m), encoding="utf-8")
        files.append(path.name)

    export_package(session, project_id)  # LEEME, escenas y créditos con los tiempos vigentes
    if project.status == ProjectStatus.VOZ_LISTA:
        project.status = ProjectStatus.TIMELINE_LISTO
    project.updated_at = now_iso()
    log_operation(session, "export", "timeline", project_id, {"formats": files})
    session.commit()
    return ExportResult(
        folder=str(folder),
        files=files,
        warnings=m.warnings,
        state=timeline_state(session, project_id),
    )
