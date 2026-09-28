"""Vista previa en vivo del timeline (sin renderizar): todo lo que la app necesita para
componer escenas, texto, subtítulos y audio en tiempo real, con los mismos tiempos del render."""

from pydantic import BaseModel
from sqlmodel import Session

from ...config import SubtitleStyle, TextStyle, load_settings
from ...models import Project
from ..render.plan import MUSIC_VOLUME, SFX_VOLUME, ZOOM
from ..voice.service import timed_words
from .model import TimelineModel, build_timeline


class PreviewMedia(BaseModel):
    kind: str  # image | video
    url: str
    source_in_s: float  # dónde empieza el tramo dentro del archivo
    duration_s: float  # lo que se ve en la escena (puede ser menor: se congela el último cuadro)


class PreviewScene(BaseModel):
    position: int
    scene_id: int | None
    kind: str
    start_s: float
    duration_s: float
    media: PreviewMedia | None
    effect: str | None
    text: str | None
    # Transición con la que entra desde la escena anterior (la de por defecto ya aplicada).
    transition_in: str | None = None
    transition_in_s: float = 0.0


class PreviewSound(BaseModel):
    name: str
    url: str
    start_s: float
    duration_s: float


class PreviewWord(BaseModel):
    text: str
    start: float
    end: float


class PreviewState(BaseModel):
    project_id: int
    width: int
    height: int
    fps: int
    duration_s: float
    scenes: list[PreviewScene]
    voice_url: str | None
    sfx: list[PreviewSound]
    music: list[PreviewSound]
    words: list[PreviewWord]  # con tiempos exactos (ElevenLabs/Whisper) o estimados (Piper)
    subtitle_style: SubtitleStyle
    text_style: TextStyle
    default_burn_subtitles: bool
    zoom: float
    music_volume: float
    sfx_volume: float


def _version(path) -> str:
    """Versión del archivo para la URL: si cambia (voz nueva, otro tramo o encuadre), el
    navegador no reutiliza la copia que tenía en caché."""
    try:
        return f"?v={path.stat().st_mtime_ns}"
    except OSError:
        return ""


def _sec(m: TimelineModel, frames: int) -> float:
    return round(frames / m.fps, 3)


def preview_state(session: Session, project: Project) -> PreviewState:
    m = build_timeline(session, project)
    cuts = m.cuts(load_settings().transitions)
    scenes = []
    for i, s in enumerate(m.scenes):
        cut = cuts[i - 1] if i > 0 else None
        media = None
        if s.clip and s.asset_id and s.scene_id:
            media = PreviewMedia(
                kind=s.clip.kind,
                url=f"/api/scenes/{s.scene_id}/assets/{s.asset_id}/approved-file"
                + _version(s.clip.path),
                source_in_s=_sec(m, s.clip.source_in),
                duration_s=_sec(m, s.clip.duration),
            )
        scenes.append(
            PreviewScene(
                position=s.position,
                scene_id=s.scene_id,
                kind=s.kind,
                start_s=_sec(m, s.start),
                duration_s=_sec(m, s.duration),
                media=media,
                effect=s.effect,
                text=s.text,
                transition_in=cut.transition if cut else None,
                transition_in_s=cut.duration if cut else 0.0,
            )
        )

    def sounds(clips) -> list[PreviewSound]:
        return [
            PreviewSound(
                name=c.name,
                url=f"/api/sounds/{c.sound_id}/file" + _version(c.path),
                start_s=_sec(m, c.start),
                duration_s=_sec(m, c.duration),
            )
            for c in clips
            if c.sound_id
        ]

    return PreviewState(
        project_id=project.id,
        width=m.width,
        height=m.height,
        fps=m.fps,
        duration_s=_sec(m, m.duration),
        scenes=scenes,
        voice_url=(
            f"/api/projects/{project.id}/voice/audio" + _version(m.voice.path) if m.voice else None
        ),
        sfx=sounds(m.sfx),
        music=sounds(m.music),
        words=[
            PreviewWord(text=w.text, start=w.start, end=w.end)
            for w in timed_words(session, project.id)
        ],
        subtitle_style=load_settings().subtitle_style,
        text_style=load_settings().text_style,
        default_burn_subtitles=project.format == "reel",
        zoom=ZOOM,
        music_volume=MUSIC_VOLUME,
        sfx_volume=SFX_VOLUME,
    )
