"""Render automático del proyecto con FFmpeg (sección 16): MP4 H.264 + AAC y miniatura.

1. Cada escena se renderiza a su duración exacta con su efecto y su texto en pantalla.
2. Los segmentos se unen sin volver a codificar.
3. Se mezcla el audio (voz, SFX, música con ducking) y, si se pide, se queman los subtítulos.
"""

import asyncio
import contextlib
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session

from ...domain.states import ORDER, ProjectStatus
from ...models._base import now_iso
from ..errors import Conflict, DomainError, NotFound
from ..jobs import JobContext
from ..media import process
from ..oplog import log_operation
from ..projects import get_project, project_dir
from ..timeline.model import TimelineModel, build_timeline
from . import plan
from .thumbnail import make_thumbnail

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
OUTPUTS = {"final": "proyecto.mp4", "draft": "proyecto_borrador.mp4"}
THUMBNAIL = "miniatura.jpg"


class RenderFile(BaseModel):
    kind: Literal["final", "draft", "thumbnail"]
    name: str
    url: str
    size_bytes: int
    duration_s: float | None
    width: int | None
    height: int | None
    updated_at: str


class RenderState(BaseModel):
    project_id: int
    can_render: bool
    reason: str | None
    has_voice: bool
    has_subtitles: bool
    default_burn_subtitles: bool  # reels: sí; videos: no (se suben aparte a YouTube)
    duration_s: float
    scenes: int
    files: list[RenderFile]


def _reason(project) -> str | None:
    if ORDER.index(project.status) < ORDER.index(ProjectStatus.MEDIOS_APROBADOS):
        return "Aprueba los medios antes de renderizar"
    return None


def _srt(project) -> Path:
    return project_dir(project) / "subs" / "voz.srt"


def render_state(session: Session, project_id: int) -> RenderState:
    project = get_project(session, project_id)
    m = build_timeline(session, project)
    folder = project_dir(project) / "render"
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


def _run(args: list[str], cwd: Path | None = None) -> None:
    try:
        proc = subprocess.run(
            args, capture_output=True, cwd=cwd, timeout=3600, creationflags=_NO_WINDOW
        )
    except FileNotFoundError as exc:
        raise DomainError("No se encontró FFmpeg. Revisa Ajustes → Dependencias.") from exc
    if proc.returncode != 0:
        lines = proc.stderr.decode("utf-8", errors="replace").strip().splitlines()
        raise DomainError("FFmpeg falló" + (f": {lines[-1]}" if lines else ""))


def _run_with_progress(args: list[str], total_s: float, cwd: Path, on_progress) -> None:
    """Como _run, pero leyendo `-progress pipe:1` para informar el avance del paso final."""
    try:
        proc = subprocess.Popen(
            [*args[:1], "-progress", "pipe:1", "-nostats", *args[1:]],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=cwd,
            creationflags=_NO_WINDOW,
        )
    except FileNotFoundError as exc:
        raise DomainError("No se encontró FFmpeg. Revisa Ajustes → Dependencias.") from exc
    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.decode("utf-8", errors="replace").strip()
        if line.startswith("out_time_us=") and total_s > 0:
            with contextlib.suppress(ValueError):
                on_progress(min(int(line.split("=", 1)[1]) / 1e6 / total_s, 1.0))
    stderr = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
    if proc.wait() != 0:
        lines = stderr.strip().splitlines()
        raise DomainError("FFmpeg falló" + (f": {lines[-1]}" if lines else ""))


def _render_sync(
    m: TimelineModel, folder: Path, srt: Path | None, draft: bool, report
) -> tuple[Path, Path | None]:
    q = plan.quality(m.width, m.height, draft)
    font = plan.find_font()
    tmp = folder / (".tmp-borrador" if draft else ".tmp-final")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        segments = _segments(m)
        files = []
        for i, seg in enumerate(segments):
            report(0.05 + 0.75 * i / len(segments), f"Escena {seg.position} de {len(segments)}…")
            textfile = None
            if seg.text:
                textfile = tmp / f"texto_{i:03d}.txt"
                textfile.write_text(seg.text, encoding="utf-8")
            out = tmp / f"seg_{i:03d}.mp4"
            _run(plan.segment_command(seg, q, out, textfile, font if textfile else None))
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
        filters = []
        if afilter:
            filters.append(afilter)
        if srt:
            shutil.copy2(srt, tmp / "subs.srt")  # nombre simple: evita escapar la ruta en Windows
            portrait = m.height > m.width
            filters.append(f"[0:v]{plan.subtitle_filter('subs.srt', portrait)}[vout]")
        if filters:
            args += ["-filter_complex", ";".join(filters)]
        args += ["-map", "[vout]" if srt else "0:v"]
        if afilter:
            args += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
        if srt:
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
        report(0.85, "Mezclando el audio" + (" y quemando los subtítulos…" if srt else "…"))
        _run_with_progress(args, total, tmp, lambda f: report(0.85 + 0.12 * f, None))
        output.unlink(missing_ok=True)
        partial.replace(output)

        report(0.98, "Creando la miniatura…")
        thumb = make_thumbnail(m, output, folder / THUMBNAIL, font)
        return output, thumb
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def render_project(
    session_factory, project_id: int, draft: bool, burn_subtitles: bool | None, ctx: JobContext
) -> dict:
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

    folder.mkdir(parents=True, exist_ok=True)
    loop = asyncio.get_running_loop()

    def report(fraction: float, message: str | None) -> None:
        loop.call_soon_threadsafe(ctx.progress, fraction, message)

    output, thumb = await asyncio.to_thread(_render_sync, m, folder, srt, draft, report)

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
            {"draft": draft, "subtitles": bool(srt), "file": output.name},
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
    }
