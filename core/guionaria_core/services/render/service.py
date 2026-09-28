"""Render automático del proyecto con FFmpeg (sección 16): MP4 H.264 + AAC y miniatura.

1. Cada escena se renderiza a su duración exacta con su efecto y su texto en pantalla.
2. Los segmentos se unen sin volver a codificar.
3. Se mezcla el audio (voz, SFX, música con ducking) y, si se pide, se queman los subtítulos.
"""

import asyncio
import contextlib
import json
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session

from ...config import SubtitleStyle, TextStyle, load_settings, save_settings
from ...domain.states import ORDER, ProjectStatus
from ...models._base import now_iso
from ..errors import Conflict, DomainError, NotFound
from ..jobs import JobCancelled, JobContext
from ..media import process
from ..oplog import log_operation
from ..projects import get_project, project_dir
from ..timeline.model import TimelineModel, build_timeline
from ..voice.align import Word
from ..voice.service import timed_words
from . import captions, plan
from .thumbnail import make_thumbnail

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
OUTPUTS = {"final": "proyecto.mp4", "draft": "proyecto_borrador.mp4"}
THUMBNAIL = "miniatura.jpg"
QUALITY_FILE = ".calidad.json"  # qué nivel de calidad tiene cada archivo del render


class RenderFile(BaseModel):
    kind: Literal["final", "draft", "thumbnail"]
    name: str
    url: str
    size_bytes: int
    duration_s: float | None
    width: int | None
    height: int | None
    updated_at: str
    quality: str | None = None  # draft | standard | high | max


class RenderState(BaseModel):
    project_id: int
    can_render: bool
    reason: str | None
    has_voice: bool
    has_subtitles: bool
    default_burn_subtitles: bool  # reels: sí; videos: no (se suben aparte a YouTube)
    subtitle_style: SubtitleStyle  # el último estilo usado
    text_style: TextStyle  # estilo del texto en pantalla (el último usado)
    duration_s: float
    scenes: int
    files: list[RenderFile]


def _reason(project) -> str | None:
    if ORDER.index(project.status) < ORDER.index(ProjectStatus.MEDIOS_APROBADOS):
        return "Aprueba los medios antes de renderizar"
    return None


def _srt(project) -> Path:
    return project_dir(project) / "subs" / "voz.srt"


def _load_quality(folder: Path) -> dict[str, str]:
    try:
        return json.loads((folder / QUALITY_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_quality(folder: Path, name: str, level: str) -> None:
    data = {**_load_quality(folder), name: level}
    (folder / QUALITY_FILE).write_text(json.dumps(data), encoding="utf-8")


def render_state(session: Session, project_id: int) -> RenderState:
    project = get_project(session, project_id)
    m = build_timeline(session, project)
    folder = project_dir(project) / "render"
    levels = _load_quality(folder)
    files = []
    for kind, name in (
        ("final", OUTPUTS["final"]),
        ("draft", OUTPUTS["draft"]),
        ("thumbnail", THUMBNAIL),
    ):
        path = folder / name
        if not path.exists():
            continue
        info = process.image_info(path) if kind == "thumbnail" else process.video_info(path)
        files.append(
            RenderFile(
                kind=kind,
                name=name,
                url=f"/api/projects/{project_id}/render/files/{name}",
                size_bytes=path.stat().st_size,
                duration_s=info.duration_s,
                width=info.width,
                height=info.height,
                updated_at=datetime.fromtimestamp(path.stat().st_mtime).isoformat(
                    timespec="seconds"
                ),
                quality=levels.get(name) if kind != "thumbnail" else None,
            )
        )
    reason = _reason(project) or (None if m.scenes else "El proyecto no tiene escenas")
    return RenderState(
        project_id=project_id,
        can_render=reason is None,
        reason=reason,
        has_voice=m.voice is not None,
        has_subtitles=_srt(project).exists(),
        default_burn_subtitles=project.format == "reel",
        subtitle_style=load_settings().subtitle_style,
        text_style=load_settings().text_style,
        duration_s=round(m.duration / m.fps, 2),
        scenes=len(m.scenes),
        files=files,
    )


def render_file(session: Session, project_id: int, name: str) -> Path:
    project = get_project(session, project_id)
    if name not in (*OUTPUTS.values(), THUMBNAIL):
        raise NotFound("Ese archivo no es del render")
    path = project_dir(project) / "render" / name
    if not path.exists():
        raise NotFound("Todavía no hay render")
    return path


# --- ejecución ---


def scene_texts(m: TimelineModel) -> list[captions.SceneText]:
    """Texto en pantalla de cada escena, en segundos del video final."""
    return [
        captions.SceneText(
            span.start / m.fps,
            (span.start + span.duration) / m.fps,
            span.text,
            centered=span.clip is None,
        )
        for span in m.scenes
        if span.text and span.text.strip()
    ]


def _segments(m: TimelineModel) -> list[plan.Segment]:
    out = []
    for span in m.scenes:
        c = span.clip
        out.append(
            plan.Segment(
                position=span.position,
                duration=span.duration / m.fps,
                kind=c.kind if c else "color",
                path=c.path if c else None,
                source_in=(c.source_in / m.fps) if c else 0,
                effect=span.effect if span.effect != "ninguno" else None,
                text=span.text,
            )
        )
    return out


def _popen(args: list[str], cwd: Path | None, stdout=subprocess.DEVNULL) -> subprocess.Popen:
    try:
        return subprocess.Popen(
            args, stdout=stdout, stderr=subprocess.PIPE, cwd=cwd, creationflags=_NO_WINDOW
        )
    except FileNotFoundError as exc:
        raise DomainError("No se encontró FFmpeg. Revisa Ajustes → Dependencias.") from exc


def _stop(proc: subprocess.Popen) -> None:
    proc.kill()
    with contextlib.suppress(Exception):
        proc.communicate(timeout=10)


def _failed(stderr: bytes | str) -> DomainError:
    text = stderr.decode("utf-8", errors="replace") if isinstance(stderr, bytes) else stderr
    lines = text.strip().splitlines()
    return DomainError("FFmpeg falló" + (f": {lines[-1]}" if lines else ""))


def _run(args: list[str], cwd: Path | None = None, cancel: threading.Event | None = None) -> None:
    """Ejecuta FFmpeg; si se cancela el trabajo, lo mata al momento."""
    proc = _popen(args, cwd)
    deadline = time.monotonic() + 3600
    while True:
        try:
            _out, err = proc.communicate(timeout=0.25)
            break
        except subprocess.TimeoutExpired:
            if cancel is not None and cancel.is_set():
                _stop(proc)
                raise JobCancelled() from None
            if time.monotonic() > deadline:
                _stop(proc)
                raise DomainError("FFmpeg tardó más de una hora en una escena") from None
    if proc.returncode != 0:
        raise _failed(err)


def _run_with_progress(
    args: list[str], total_s: float, cwd: Path, on_progress, cancel: threading.Event | None = None
) -> None:
    """Como _run, pero leyendo `-progress pipe:1` para informar el avance del paso final."""
    proc = _popen([*args[:1], "-progress", "pipe:1", "-nostats", *args[1:]], cwd, subprocess.PIPE)
    assert proc.stdout is not None
    for raw in proc.stdout:
        if cancel is not None and cancel.is_set():
            _stop(proc)
            raise JobCancelled()
        line = raw.decode("utf-8", errors="replace").strip()
        if line.startswith("out_time_us=") and total_s > 0:
            with contextlib.suppress(ValueError):
                on_progress(min(int(line.split("=", 1)[1]) / 1e6 / total_s, 1.0))
    stderr = proc.stderr.read() if proc.stderr else b""
    if cancel is not None and cancel.is_set():
        _stop(proc)
        raise JobCancelled()
    if proc.wait() != 0:
        raise _failed(stderr)


def _render_sync(
    m: TimelineModel,
    folder: Path,
    srt: Path | None,
    level: plan.Level,
    report,
    cancel: threading.Event | None = None,
    words: list[Word] | None = None,
    style: SubtitleStyle | None = None,
    text_style: TextStyle | None = None,
) -> tuple[Path, Path | None]:
    draft = level == "draft"
    q = plan.quality(m.width, m.height, level)
    font = plan.find_font()
    tmp = folder / (".tmp-borrador" if draft else ".tmp-final")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        segments = _segments(m)
        files = []
        for i, seg in enumerate(segments):
            report(0.05 + 0.75 * i / len(segments), f"Escena {seg.position} de {len(segments)}…")
            out = tmp / f"seg_{i:03d}.mp4"
            # El texto en pantalla no va aquí: se escribe con libass en el paso final.
            _run(plan.segment_command(seg, q, out, None, None, draft=draft), cancel=cancel)
            files.append(out)

        report(0.82, "Uniendo las escenas…")
        listing = tmp / "escenas.txt"
        listing.write_text("".join(f"file '{f.name}'\n" for f in files), encoding="utf-8")
        video = tmp / "video.mp4"
        _run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                listing.name,
                "-c",
                "copy",
                video.name,
            ],
            cwd=tmp,
            cancel=cancel,
        )

        total = m.duration / m.fps
        sec = lambda f: f / m.fps  # noqa: E731
        voice = plan.AudioClip(m.voice.path, 0, sec(m.voice.duration)) if m.voice else None
        sfx = [plan.AudioClip(c.path, sec(c.start), sec(c.duration)) for c in m.sfx]
        music = [plan.AudioClip(c.path, sec(c.start), sec(c.duration)) for c in m.music]
        afilter, audio_inputs = plan.audio_filter(voice, sfx, music, first_input=1)

        args = ["ffmpeg", "-y", "-v", "error", "-i", video.name]
        for clip in audio_inputs:
            args += ["-i", str(clip.path)]
        # El audio va en -filter_complex y el video en -vf: son grafos separados, así que si
        # FFmpeg reinicia los filtros de video (cambio de formato entre escenas) no toca el
        # audio. En un mismo grafo, ese reinicio adelantaba la voz a los subtítulos.
        if afilter:
            args += ["-filter_complex", afilter]
        vfilter = None
        texts = scene_texts(m)
        styled = bool(srt and words)
        if styled or texts:
            # Subtítulos con estilo (frases cortas, palabra resaltada) y texto de las escenas.
            ass = captions.build_ass(
                words if styled else [],
                style or SubtitleStyle(),
                q.width,
                q.height,
                texts,
                text_style,
                raised=bool(srt),
            )
            (tmp / "subs.ass").write_text(ass, encoding="utf-8")
            # Fuentes incluidas (Montserrat…) en una carpeta local: sin escapar rutas de Windows.
            if captions.FONTS_DIR.exists():
                shutil.copytree(captions.FONTS_DIR, tmp / "fonts", dirs_exist_ok=True)
                vfilter = "ass=subs.ass:fontsdir=fonts"
            else:
                vfilter = "ass=subs.ass"
        if srt and not styled:
            shutil.copy2(srt, tmp / "subs.srt")  # nombre simple: evita escapar la ruta en Windows
            plain = plan.subtitle_filter("subs.srt", m.height > m.width)
            vfilter = f"{plain},{vfilter}" if vfilter else plain
        args += ["-map", "0:v"]
        if vfilter:
            args += ["-vf", vfilter]
        if afilter:
            args += ["-map", "[aout]", "-c:a", "aac", "-b:a", q.audio_bitrate]
        if vfilter:
            args += [
                "-c:v",
                "libx264",
                "-preset",
                q.preset,
                "-crf",
                str(q.crf),
                "-pix_fmt",
                "yuv420p",
            ]
        else:
            args += ["-c:v", "copy"]
        output = folder / OUTPUTS["draft" if draft else "final"]
        partial = tmp / "salida.mp4"
        args += ["-t", f"{total:.3f}", "-movflags", "+faststart", partial.name]
        report(0.85, "Mezclando el audio" + (" y escribiendo los textos…" if vfilter else "…"))
        _run_with_progress(args, total, tmp, lambda f: report(0.85 + 0.12 * f, None), cancel)
        output.unlink(missing_ok=True)
        partial.replace(output)

        report(0.98, "Creando la miniatura…")
        thumb = make_thumbnail(m, output, folder / THUMBNAIL, font)
        return output, thumb
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def render_project(
    session_factory,
    project_id: int,
    level: plan.Level | bool,
    burn_subtitles: bool | None,
    ctx: JobContext,
    style: SubtitleStyle | None = None,
    text_style: TextStyle | None = None,
) -> dict:
    if isinstance(level, bool):
        level = "draft" if level else "standard"
    draft = level == "draft"
    with session_factory() as session:
        project = get_project(session, project_id)
        reason = _reason(project)
        if reason:
            raise Conflict(reason)
        m = build_timeline(session, project)
        if not m.scenes:
            raise Conflict("El proyecto no tiene escenas")
        folder = project_dir(project) / "render"
        burn = project.format == "reel" if burn_subtitles is None else burn_subtitles
        srt = _srt(project) if burn and _srt(project).exists() else None
        words = timed_words(session, project_id) if srt else []
    if style is not None or text_style is not None:
        settings = load_settings()  # se recuerdan para la próxima vez
        settings.subtitle_style = style or settings.subtitle_style
        settings.text_style = text_style or settings.text_style
        save_settings(settings)
    style = style or load_settings().subtitle_style
    text_style = text_style or load_settings().text_style

    folder.mkdir(parents=True, exist_ok=True)
    loop = asyncio.get_running_loop()

    def report(fraction: float, message: str | None) -> None:
        loop.call_soon_threadsafe(ctx.progress, fraction, message)

    output, thumb = await asyncio.to_thread(
        _render_sync, m, folder, srt, level, report, ctx.cancel_event, words, style, text_style
    )
    _save_quality(folder, output.name, level)

    with session_factory() as session:
        project = get_project(session, project_id)
        if not draft and ORDER.index(ProjectStatus.VOZ_LISTA) <= ORDER.index(
            project.status
        ) < ORDER.index(ProjectStatus.RENDERIZADO):
            project.status = ProjectStatus.RENDERIZADO
        project.updated_at = now_iso()
        log_operation(
            session,
            "render",
            "project",
            project_id,
            {"quality": level, "subtitles": bool(srt), "file": output.name},
            actor="system",
        )
        session.commit()
    info = process.video_info(output)
    return {
        "file": output.name,
        "duration_s": info.duration_s,
        "width": info.width,
        "height": info.height,
        "thumbnail": thumb.name if thumb else None,
        "subtitles": bool(srt),
        "quality": level,
    }
