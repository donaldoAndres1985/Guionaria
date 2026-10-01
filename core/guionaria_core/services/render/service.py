"""Render automático del proyecto con FFmpeg (sección 16): MP4 H.264 + AAC y miniatura.

1. Cada escena se renderiza a su duración exacta con su efecto y su texto en pantalla.
2. Los segmentos se unen sin volver a codificar.
3. Se mezcla el audio (voz, SFX, música a volumen fijo) y, si se pide, se queman los subtítulos.
"""

import asyncio
import contextlib
import functools
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from pydantic import BaseModel
from sqlmodel import Session

from ...config import (
    SubtitleStyle,
    TextStyle,
    TransitionPrefs,
    VideoLook,
    load_settings,
    save_settings,
)
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
from . import captions, plan, transitions
from . import look as looks
from .thumbnail import make_thumbnail

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
log = logging.getLogger(__name__)
OUTPUTS = {"final": "proyecto.mp4", "draft": "proyecto_borrador.mp4"}  # nombres antiguos
THUMBNAIL = "miniatura.jpg"
DRAFT_SUFFIX = "_borrador"
MAX_NAME = 70


def slug_name(title: str) -> str:
    """Nombre de archivo legible a partir del título: «María Marta García Belsunce: el
    asesinato…» → «maria-marta-garcia-belsunce-el-asesinato…» (sin tildes, corto)."""
    import re
    import unicodedata

    text = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    if len(text) > MAX_NAME:
        text = text[:MAX_NAME].rsplit("-", 1)[0]
    return text or "video"


def output_names(project) -> dict[str, str]:
    base = slug_name(project.title)
    return {"final": f"{base}.mp4", "draft": f"{base}{DRAFT_SUFFIX}.mp4"}


def find_output(project, kind: str = "final") -> Path | None:
    """El video del render aunque tenga otro nombre: el del título, el antiguo
    (proyecto.mp4) o, para el final, el MP4 más reciente de la carpeta (si se renombró)."""
    folder = project_dir(project) / "render"
    for name in (output_names(project)[kind], OUTPUTS[kind]):
        if (folder / name).exists():
            return folder / name
    if kind != "final" or not folder.exists():
        return None
    others = [
        f
        for f in folder.glob("*.mp4")
        if not f.stem.endswith(DRAFT_SUFFIX) and f.name != OUTPUTS["draft"]
    ]
    return max(others, key=lambda f: f.stat().st_mtime) if others else None


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
    look: VideoLook  # look del video (el último usado)
    luts: list[str]  # LUT .cube importados
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
    for kind, path in (
        ("final", find_output(project, "final")),
        ("draft", find_output(project, "draft")),
        ("thumbnail", folder / THUMBNAIL),
    ):
        if path is None or not path.exists():
            continue
        name = path.name
        info = process.image_info(path) if kind == "thumbnail" else process.video_info(path)
        files.append(
            RenderFile(
                kind=kind,
                name=name,
                url=f"/api/projects/{project_id}/render/files/{quote(name)}",
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
        look=load_settings().look,
        luts=looks.list_luts(),
        duration_s=round(m.duration / m.fps, 2),
        scenes=len(m.scenes),
        files=files,
    )


def render_file(session: Session, project_id: int, name: str) -> Path:
    """Un video o imagen de la carpeta render/ (con el nombre que tenga)."""
    project = get_project(session, project_id)
    folder = project_dir(project) / "render"
    path = folder / Path(name).name
    if path.suffix.lower() not in (".mp4", ".jpg") or path.parent != folder:
        raise NotFound("Ese archivo no es del render")
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


def _effect(effect: str | None, kind: str | None, look: VideoLook | None) -> str | None:
    """Efecto de la escena; con el look «zoom lento en fotos», las fotos sin efecto lo llevan."""
    chosen = effect if effect != "ninguno" else None
    if chosen is None and kind == "image" and look and look.zoom_photos:
        return look.photo_effect
    return chosen


def _join_with_transitions(
    m: TimelineModel,
    files: list[Path],
    cuts: list[transitions.Cut],
    q: plan.Quality,
    out: Path,
    encode_again: bool,
    cancel: threading.Event | None,
    hardware: str | None = None,
) -> None:
    """Une los segmentos con xfade. Si el paso final vuelve a codificar (subtítulos o
    texto), este va rápido y casi sin pérdida; si no, con la calidad elegida."""
    starts, acc = [], 0
    for span in m.scenes:
        starts.append(acc / m.fps)
        acc += span.duration
    graph, label = plan.join_filter(len(files), cuts, starts)
    args = ["ffmpeg", "-y", "-v", "error"]
    for f in files:
        args += ["-i", f.name]
    args += [
        "-filter_complex", graph, "-map", f"[{label}]",
        *plan.encoder(q, encode_again, hardware), "-pix_fmt", "yuv420p",
        "-color_range", "tv", "-t", f"{m.duration / m.fps:.3f}", out.name,
    ]  # fmt: skip
    _run(args, cwd=out.parent, cancel=cancel)


def _segments(
    m: TimelineModel, cuts: list[transitions.Cut], look: VideoLook | None = None
) -> list[plan.Segment]:
    out = []
    for i, span in enumerate(m.scenes):
        c = span.clip
        # Con transición, la escena que sale dura un poco más: se funde con la siguiente.
        tail = round(cuts[i].duration * m.fps) if i < len(cuts) else 0
        out.append(
            plan.Segment(
                position=span.position,
                duration=(span.duration + tail) / m.fps,
                kind=c.kind if c else "color",
                path=c.path if c else None,
                source_in=(c.source_in / m.fps) if c else 0,
                effect=_effect(span.effect, c.kind if c else None, look),
                text=span.text,
            )
        )
    return out


_hardware_failed = False  # la GPU falló en un render: el resto de la sesión, con x264


@functools.cache
def _detect_hardware() -> str | None:
    """El primer codificador H.264 de la GPU (NVIDIA, Intel) que de verdad codifica: estar
    compilado en FFmpeg no basta, hace falta la placa y su controlador."""
    for name in plan.HARDWARE_ENCODERS:
        q = plan.Quality(256, 256, "veryfast", 20, hardware_ok=True)
        args = [
            "ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi",
            "-i", "color=c=black:s=256x256:r=30:d=0.2", "-pix_fmt", "yuv420p",
            *plan.encoder(q, False, name), "-f", "null", "-",
        ]  # fmt: skip
        try:
            ok = (
                subprocess.run(
                    args, capture_output=True, timeout=20, creationflags=_NO_WINDOW
                ).returncode
                == 0
            )
        except (OSError, subprocess.TimeoutExpired):
            ok = False
        if ok:
            log.info("Render con codificador por hardware: %s", name)
            return name
    return None


def hardware_encoder() -> str | None:
    return None if _hardware_failed else _detect_hardware()


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


class _Stop:
    """Cancelación del trabajo o de las escenas en paralelo (si una falla, paran todas)."""

    def __init__(self, cancel: threading.Event | None) -> None:
        self.cancel = cancel
        self.failed = threading.Event()

    def is_set(self) -> bool:
        return self.failed.is_set() or (self.cancel is not None and self.cancel.is_set())


def segment_workers() -> int:
    """Escenas a la vez: el filtro de movimiento no ocupa todos los núcleos, así que con
    3 en paralelo las escenas tardan casi la mitad (medido en un portátil de 12 hilos)."""
    return max(1, min(3, (os.cpu_count() or 2) // 4))


def _run_segments(commands: list[list[str]], report, cancel: threading.Event | None) -> None:
    stop = _Stop(cancel)
    done = 0
    lock = threading.Lock()

    def work(args: list[str]) -> None:
        nonlocal done
        try:
            _run(args, cancel=stop)  # type: ignore[arg-type]
        except BaseException:
            stop.failed.set()
            raise
        with lock:
            done += 1
            report(0.05 + 0.75 * done / len(commands), f"Escena {done} de {len(commands)}…")

    report(0.05, f"Escena 1 de {len(commands)}…")
    with ThreadPoolExecutor(segment_workers()) as pool:
        futures = [pool.submit(work, args) for args in commands]
        errors = [f.exception() for f in futures]
    if cancel is not None and cancel.is_set():
        raise JobCancelled()
    # El primer error real (las demás escenas se detuvieron por él).
    first = next((e for e in errors if e and not isinstance(e, JobCancelled)), None)
    if first is not None:
        raise first
    if any(errors):
        raise next(e for e in errors if e)


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
    prefs: TransitionPrefs | None = None,
    look: VideoLook | None = None,
    names: dict[str, str] | None = None,
) -> tuple[Path, Path | None]:
    """Renderiza con el codificador de la GPU si lo hay (borrador y estándar); si falla a
    mitad de camino, se repite con x264 y no se vuelve a usar la GPU en esta sesión."""
    global _hardware_failed
    ok = plan.quality(m.width, m.height, level).hardware_ok
    hardware = hardware_encoder() if ok else None
    rest = (words, style, text_style, prefs, look, names)
    try:
        return _render_pass(m, folder, srt, level, report, cancel, *rest, hardware=hardware)
    except DomainError as exc:
        if not hardware:
            raise
        log.warning("Falló el render con %s (%s); se repite con x264", hardware, exc)
        _hardware_failed = True
        report(0.05, "La GPU falló; se renderiza con el procesador…")
        return _render_pass(m, folder, srt, level, report, cancel, *rest, hardware=None)


def _render_pass(
    m: TimelineModel,
    folder: Path,
    srt: Path | None,
    level: plan.Level,
    report,
    cancel: threading.Event | None = None,
    words: list[Word] | None = None,
    style: SubtitleStyle | None = None,
    text_style: TextStyle | None = None,
    prefs: TransitionPrefs | None = None,
    look: VideoLook | None = None,
    names: dict[str, str] | None = None,
    hardware: str | None = None,
) -> tuple[Path, Path | None]:
    draft = level == "draft"
    q = plan.quality(m.width, m.height, level)
    font = plan.find_font()
    tmp = folder / (".tmp-borrador" if draft else ".tmp-final")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        cuts = m.cuts(prefs or TransitionPrefs())
        segments = _segments(m, cuts, look)
        soften = looks.soften_sigma(look)
        motion = (look.motion if look else 100) / 100
        # Si después se escriben subtítulos o texto, o se aplica el look, el paso final vuelve
        # a codificar: las escenas y la unión son archivos intermedios.
        graded_look = bool(look and looks.look_filter(look, look.lut))
        again = bool(srt) or bool(scene_texts(m)) or bool(m.overlay_texts) or graded_look
        files = [tmp / f"seg_{i:03d}.mp4" for i in range(len(segments))]
        # El texto en pantalla no va aquí: se escribe con libass en el paso final.
        commands = [
            plan.segment_command(
                seg,
                q,
                out,
                None,
                None,
                draft=draft,
                soften=soften,
                motion=motion,
                intermediate=again,
                hardware=hardware,
            )
            for seg, out in zip(segments, files, strict=True)
        ]
        _run_segments(commands, report, cancel)

        video = tmp / "video.mp4"
        if any(c.transition for c in cuts):
            report(0.82, "Uniendo las escenas con sus transiciones…")
            _join_with_transitions(m, files, cuts, q, video, again, cancel, hardware)
        else:
            report(0.82, "Uniendo las escenas…")
            listing = tmp / "escenas.txt"
            listing.write_text("".join(f"file '{f.name}'\n" for f in files), encoding="utf-8")
            _run(
                ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                 "-i", listing.name, "-c", "copy", video.name],
                cwd=tmp,
                cancel=cancel,
            )  # fmt: skip

        total = m.duration / m.fps
        sec = lambda f: f / m.fps  # noqa: E731
        voice = plan.AudioClip(m.voice.path, 0, sec(m.voice.duration)) if m.voice else None
        sfx = [plan.AudioClip(c.path, sec(c.start), sec(c.duration)) for c in m.sfx]
        sfx += [
            plan.AudioClip(
                c.path, sec(c.start), sec(c.duration), False, c.volume, c.fade_in, c.fade_out
            )
            for c in m.overlay_sfx
        ]
        music = [
            plan.AudioClip(c.path, sec(c.start), sec(c.duration), c.loop, c.volume) for c in m.music
        ]
        afilter, audio_inputs = plan.audio_filter(voice, sfx, music, first_input=1)

        args = ["ffmpeg", "-y", "-v", "error", "-i", video.name]
        for clip in audio_inputs:
            if clip.loop:  # el audio de fondo se repite hasta el final del video
                args += ["-stream_loop", "-1"]
            args += ["-i", str(clip.path)]
        # El audio va en -filter_complex y el video en -vf: son grafos separados, así que si
        # FFmpeg reinicia los filtros de video (cambio de formato entre escenas) no toca el
        # audio. En un mismo grafo, ese reinicio adelantaba la voz a los subtítulos.
        if afilter:
            args += ["-filter_complex", afilter]
        vfilter = None
        texts = scene_texts(m)
        styled = bool(srt and words)
        if styled or texts or m.overlay_texts:
            # Subtítulos con estilo (frases cortas, palabra resaltada), texto de las escenas y
            # los textos de las pistas manuales.
            ass = captions.build_ass(
                words if styled else [],
                style or SubtitleStyle(),
                q.width,
                q.height,
                texts,
                text_style,
                raised=bool(srt),
                overlays=m.overlay_texts,
                overlay_scale=q.width / m.width,
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
        # Look (clip de ajuste) antes del texto y los subtítulos: a ellos no los toca.
        lut = None
        if look and look.lut:
            shutil.copyfile(looks.lut_path(look.lut), tmp / looks.LUT_NAME)
            lut = looks.LUT_NAME
        graded = looks.look_filter(look, lut) if look else None
        if graded:
            vfilter = f"{graded},{vfilter}" if vfilter else graded
        args += ["-map", "0:v"]
        if vfilter:
            args += ["-vf", vfilter]
        if afilter:
            args += ["-map", "[aout]", "-c:a", "aac", "-b:a", q.audio_bitrate]
        if vfilter:
            args += [*plan.encoder(q, False, hardware), "-pix_fmt", "yuv420p"]
        else:
            args += ["-c:v", "copy"]
        kind = "draft" if draft else "final"
        output = folder / (names or OUTPUTS)[kind]
        partial = tmp / "salida.mp4"
        args += ["-t", f"{total:.3f}", "-movflags", "+faststart", partial.name]
        report(0.85, "Mezclando el audio" + (" y escribiendo los textos…" if vfilter else "…"))
        _run_with_progress(args, total, tmp, lambda f: report(0.85 + 0.12 * f, None), cancel)
        output.unlink(missing_ok=True)
        partial.replace(output)
        legacy = folder / OUTPUTS[kind]
        if legacy != output:
            legacy.unlink(missing_ok=True)  # el antiguo proyecto.mp4 ya no hace falta

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
    look: VideoLook | None = None,
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
        names = output_names(project)
        burn = project.format == "reel" if burn_subtitles is None else burn_subtitles
        srt = _srt(project) if burn and _srt(project).exists() else None
        words = timed_words(session, project_id) if srt else []
    if style is not None or text_style is not None or look is not None:
        settings = load_settings()  # se recuerdan para la próxima vez
        settings.subtitle_style = style or settings.subtitle_style
        settings.text_style = text_style or settings.text_style
        settings.look = look or settings.look
        save_settings(settings)
    style = style or load_settings().subtitle_style
    text_style = text_style or load_settings().text_style
    look = look or load_settings().look
    if look.lut:
        looks.lut_path(look.lut)  # falla antes de empezar si el LUT ya no está

    folder.mkdir(parents=True, exist_ok=True)
    loop = asyncio.get_running_loop()

    def report(fraction: float, message: str | None) -> None:
        loop.call_soon_threadsafe(ctx.progress, fraction, message)

    output, thumb = await asyncio.to_thread(
        _render_sync,
        m,
        folder,
        srt,
        level,
        report,
        ctx.cancel_event,
        words,
        style,
        text_style,
        load_settings().transitions,
        look,
        names,
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
