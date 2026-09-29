"""Videos terminados en otro editor (CapCut, Premiere…): se importan a un canal como proyecto
«importado» listo para publicar. Se saltan las etapas de producción y se gestiona todo desde
Publicación: textos con Claude, miniatura, subida o publicación a mano y enlaces.

Para que Claude escriba bien los textos sin guion, el audio se transcribe con Whisper (local)
y la transcripción queda en publicacion/transcripcion.txt.
"""

import asyncio
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlmodel import Session

from ..config import load_settings
from ..domain.states import ProjectStatus
from ..models import Project
from ..models._base import now_iso
from ..schemas.project import ProjectCreate
from .channels import get_channel
from .errors import Conflict, DomainError
from .jobs import JobContext
from .media import process
from .oplog import log_operation
from .projects import create_project, get_project, project_dir

VIDEO_EXT = (".mp4", ".mov", ".m4v", ".mkv", ".webm")
TRANSCRIPT = "transcripcion.txt"
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def _ffmpeg(args: list[str]) -> bool:
    proc = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", *args], capture_output=True, creationflags=_NO_WINDOW
    )
    return proc.returncode == 0


def _probe(path: Path) -> process.MediaInfo:
    try:
        info = process.video_info(path)
    except Exception as exc:  # noqa: BLE001  (ffprobe no lo reconoce)
        raise DomainError("No se pudo leer el video: ¿es un archivo de video válido?") from exc
    if not info.width or not info.height or not info.duration_s:
        raise DomainError("El archivo no tiene imagen de video (o está dañado)")
    return info


def _place_video(project: Project, source: Path) -> Path:
    """Deja el video en render/<nombre del título>.mp4 (se remuxa sin recodificar si viene
    en otro contenedor: .mov, .mkv…)."""
    from .render.service import OUTPUTS, output_names

    folder = project_dir(project) / "render"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / output_names(project)["final"]
    for old in (target, folder / OUTPUTS["final"]):
        old.unlink(missing_ok=True)
    if source.suffix.lower() == ".mp4":
        shutil.copyfile(source, target)
    elif not _ffmpeg(["-i", str(source), "-c", "copy", "-movflags", "+faststart", str(target)]):
        raise DomainError(
            "No se pudo convertir a MP4 sin recodificar: exporta el video como MP4 (H.264) "
            "desde tu editor"
        )
    return target


def _thumbnail(project: Project, video: Path, duration: float) -> None:
    """Miniatura sugerida: un cuadro al 20 % del video (luego se cambia en Publicación)."""
    from .render.service import THUMBNAIL

    out = project_dir(project) / "render" / THUMBNAIL
    at = f"{duration * 0.2:.2f}"
    _ffmpeg(["-ss", at, "-i", str(video), "-frames:v", "1", "-q:v", "3", str(out)])


def import_video(
    session: Session,
    channel_id: int,
    source: Path,
    title: str,
    notes: str | None = None,
    target_publish_at: str | None = None,
) -> Project:
    if source.suffix.lower() not in VIDEO_EXT:
        raise DomainError("Formato no admitido: usa MP4, MOV, M4V, MKV o WebM")
    get_channel(session, channel_id)
    info = _probe(source)
    fmt = "reel" if info.height > info.width else "video"
    created = create_project(
        session,
        ProjectCreate(
            channel_id=channel_id,
            title=title.strip() or source.stem,
            format=fmt,
            research_notes=(notes or "").strip() or None,
            target_duration_s=max(5, min(round(info.duration_s), 4 * 3600)),
            target_publish_at=target_publish_at or None,
        ),
    )
    project = get_project(session, created.id)
    video = _place_video(project, source)
    _thumbnail(project, video, info.duration_s)
    project.origin = "importado"
    project.status = ProjectStatus.RENDERIZADO
    project.updated_at = now_iso()
    log_operation(
        session,
        "import_video",
        "project",
        project.id,
        {"file": source.name, "format": fmt, "duration_s": round(info.duration_s, 1)},
    )
    session.commit()
    session.refresh(project)
    return project


def replace_video(session: Session, project_id: int, source: Path) -> Project:
    """Nueva versión del video (p. ej. otra exportación de CapCut)."""
    project = get_project(session, project_id)
    if source.suffix.lower() not in VIDEO_EXT:
        raise DomainError("Formato no admitido: usa MP4, MOV, M4V, MKV o WebM")
    info = _probe(source)
    video = _place_video(project, source)
    _thumbnail(project, video, info.duration_s)
    project.target_duration_s = max(5, min(round(info.duration_s), 4 * 3600))
    project.updated_at = now_iso()
    log_operation(session, "replace_video", "project", project.id, {"file": source.name})
    session.commit()
    return project


def transcript_path(project: Project) -> Path:
    return project_dir(project) / "publicacion" / TRANSCRIPT


def read_transcript(project: Project) -> str | None:
    path = transcript_path(project)
    return path.read_text(encoding="utf-8") if path.exists() else None


async def transcribe_video(session_factory, project_id: int, ctx: JobContext) -> dict:
    """Whisper escucha el audio del video y deja la transcripción para los textos de Claude."""
    from .publishing.service import final_video
    from .voice import engines, models

    with session_factory() as session:
        project = get_project(session, project_id)
        video = final_video(project)
        if not video.exists():
            raise Conflict("El proyecto no tiene video")
        language = get_channel(session, project.channel_id).language
        out = transcript_path(project)
    size = load_settings().whisper_model
    model_dir = await models.ensure_whisper(size, ctx)
    with tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
        audio = Path(tmp) / "audio.wav"
        ctx.progress(0.25, "Sacando el audio del video…")
        ok = await asyncio.to_thread(
            _ffmpeg, ["-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(audio)]
        )
        if not ok:
            raise DomainError("El video no tiene audio que transcribir")
        ctx.progress(0.35, "Whisper está escuchando el video…")
        transcriber = await asyncio.to_thread(engines.transcriber_factory, model_dir)
        words = await asyncio.to_thread(transcriber.transcribe, audio, language)
    if not words:
        raise DomainError("Whisper no encontró voz en el video")
    text = " ".join(w.text.strip() for w in words if w.text.strip())
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    with session_factory() as session:
        details = {"words": len(words)}
        log_operation(session, "transcribe", "project", project_id, details, actor="system")
        session.commit()
    return {"words": len(words)}
