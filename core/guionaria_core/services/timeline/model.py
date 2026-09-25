"""Modelo intermedio del timeline (sección 5.10): se arma una vez desde la base de datos y
cada formato (OTIO, FCPXML, EDL) lo escribe a su manera.

Todo se expresa en cuadros enteros para que los tres formatos coincidan exactamente.
- Cada escena empieza en su inicio y dura hasta el inicio de la siguiente: el video queda
  continuo aunque la voz tenga pausas entre segmentos.
- Texto, negro y escenas sin medio quedan como hueco en la pista de video, con un marcador.
"""

from dataclasses import dataclass, field
from pathlib import Path

from sqlmodel import Session, col, select

from ...config import get_paths
from ...models import Asset, Project, Scene, SceneAsset
from ...schemas.scene import TIPO_FROM_KIND
from ..voice.service import latest_track

FPS = 30
NEEDS_MEDIA = ("video", "image", "real")


@dataclass
class Clip:
    name: str
    path: Path
    kind: str  # image | video | audio
    start: int  # cuadro en el timeline
    duration: int  # cuadros
    source_in: int = 0  # cuadro de inicio dentro del archivo
    media_duration: int | None = None  # None: imagen fija (sin límite)
    scene_position: int | None = None


@dataclass
class Marker:
    frame: int
    name: str
    note: str
    color: str  # ORANGE | BLUE | PURPLE | GREEN


@dataclass
class SceneSpan:
    position: int
    kind: str
    start: int
    duration: int
    clip: Clip | None
    text: str | None
    asset_id: int | None


@dataclass
class TimelineModel:
    title: str
    fps: int
    width: int
    height: int
    duration: int
    scenes: list[SceneSpan]
    voice: Clip | None
    markers: list[Marker]
    warnings: list[str] = field(default_factory=list)

    def video_items(self) -> list[tuple[int, int, Clip | None]]:
        """Pista de video como (inicio, duración, clip); None es un hueco. Los huecos seguidos
        (video corto + escena sin medio) se unen en uno."""
        items: list[tuple[int, int, Clip | None]] = []

        def gap(start: int, duration: int) -> None:
            if items and items[-1][2] is None:
                prev_start, prev_duration, _ = items.pop()
                items.append((prev_start, prev_duration + duration, None))
            else:
                items.append((start, duration, None))

        cursor = 0
        for span in self.scenes:
            c = span.clip
            if c:
                if c.start > cursor:
                    gap(cursor, c.start - cursor)
                items.append((c.start, c.duration, c))
                cursor = c.start + c.duration
            end = span.start + span.duration
            if end > cursor:
                gap(cursor, end - cursor)
                cursor = end
        return items


def frames(seconds: float | None, fps: int = FPS) -> int:
    return round((seconds or 0) * fps)


def _main_rows(session: Session, scene_ids: list[int]) -> dict[int, tuple[SceneAsset, Asset]]:
    rows = session.exec(
        select(SceneAsset).where(col(SceneAsset.scene_id).in_(scene_ids), SceneAsset.role == "main")
    ).all()
    out = {}
    for row in rows:
        asset = session.get(Asset, row.asset_id)
        if asset and row.file_path:
            out[row.scene_id] = (row, asset)
    return out


def _marker(scene: Scene, start: int) -> Marker:
    tipo = TIPO_FROM_KIND[scene.media_kind]
    notes = []
    if scene.effect and scene.effect != "ninguno":
        notes.append(f"Efecto: {scene.effect}")
    if scene.on_screen_text:
        notes.append(f"Texto: «{scene.on_screen_text}»")
    if scene.sfx:
        notes.append(f"SFX: {scene.sfx}")
    if scene.music_cue:
        notes.append(f"Música: {scene.music_cue}")
    color = "BLUE" if scene.media_kind == "text" else "ORANGE" if notes else "GREEN"
    return Marker(start, f"Escena {scene.position} · {tipo}", " · ".join(notes), color)


def build_timeline(session: Session, project: Project) -> TimelineModel:
    home = get_paths().home
    scenes = session.exec(
        select(Scene).where(Scene.project_id == project.id).order_by(col(Scene.position))
    ).all()
    main = _main_rows(session, [s.id for s in scenes])
    track = latest_track(session, project.id)
    warnings: list[str] = []

    voice = None
    if track and track.file_path and (home / track.file_path).exists():
        voice_len = frames(track.duration_s)
        voice = Clip("Voz", home / track.file_path, "audio", 0, voice_len, 0, voice_len)
    else:
        warnings.append("El proyecto no tiene voz: el timeline usa los tiempos estimados.")

    starts = [0 if i == 0 else frames(s.start_s) for i, s in enumerate(scenes)]
    last_end = frames(scenes[-1].end_s) if scenes else 0
    total = max(last_end, voice.duration if voice else 0)

    spans: list[SceneSpan] = []
    markers: list[Marker] = []
    for i, scene in enumerate(scenes):
        start = starts[i]
        end = starts[i + 1] if i + 1 < len(scenes) else total
        duration = max(end - start, 1)
        markers.append(_marker(scene, start))
        clip = None
        pair = main.get(scene.id)
        if pair:
            row, asset = pair
            path = home / row.file_path
            if not path.exists():
                warnings.append(f"Escena {scene.position}: falta el archivo {path.name}")
            else:
                is_video = asset.kind == "video"
                source_in = frames(row.trim_in_s) if is_video else 0
                media_len = frames(asset.duration_s) if is_video and asset.duration_s else None
                clip_len = duration
                if media_len is not None and source_in + clip_len > media_len:
                    clip_len = max(media_len - source_in, 1)
                    warnings.append(
                        f"Escena {scene.position}: el video dura {media_len / FPS:.1f} s y la "
                        f"escena {duration / FPS:.1f} s; queda un hueco al final"
                    )
                clip = Clip(
                    path.name,
                    path,
                    "video" if is_video else "image",
                    start,
                    clip_len,
                    source_in,
                    media_len,
                    scene.position,
                )
        elif scene.media_kind in NEEDS_MEDIA:
            warnings.append(f"Escena {scene.position}: no tiene medio aprobado")
        spans.append(
            SceneSpan(
                scene.position,
                scene.media_kind,
                start,
                duration,
                clip,
                scene.on_screen_text,
                pair[1].id if pair else None,
            )
        )

    width, height = (1920, 1080) if project.format == "video" else (1080, 1920)
    return TimelineModel(project.title, FPS, width, height, total, spans, voice, markers, warnings)
