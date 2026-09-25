"""Voz del proyecto y tiempos reales (sección 5.9 de SPEC.md).

- Voz generada con Piper, segmento por segmento (se puede regenerar uno solo): como la app sabe
  cuánto dura cada frase, los tiempos reales salen al instante.
- Voz grabada (subida): Whisper la transcribe con tiempos por palabra y se alinea con el guion.
- Los tiempos reales reemplazan a los estimados en la tabla de escenas y se escriben SRT/VTT.
- Si el guion cambia después, la voz queda «desactualizada» y vuelven los tiempos estimados.
"""

import asyncio
import json
import shutil
import wave
from pathlib import Path

from pydantic import BaseModel
from sqlmodel import Session, col, delete, select

from ...config import get_paths, load_settings
from ...domain.states import ORDER, ProjectStatus
from ...models import Project, VoiceTrack
from ...models._base import now_iso
from ..channels import get_channel
from ..errors import Conflict, DomainError, NotFound
from ..jobs import JobContext
from ..media import process
from ..oplog import log_operation
from ..projects import get_project, project_dir
from ..script import current_version, read_script, text_hash
from . import engines, models
from .align import SegmentTiming, Word, align_segments
from .subtitles import cues_from_segments, cues_from_words, to_srt, to_vtt

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac"}
DEFAULT_PAUSE_S = 0.3


class SegmentVoice(BaseModel):
    seg_key: str
    text: str
    start_s: float | None
    end_s: float | None
    audio_url: str | None


class VoiceState(BaseModel):
    project_id: int
    can_edit: bool
    reason: str | None  # por qué no se puede todavía
    source: str | None  # piper | recorded
    voice_id: str | None
    speed: float | None
    duration_s: float | None
    audio_url: str | None
    timing_source: str | None  # voice | whisper | None (sin tiempos reales)
    stale: bool  # el guion cambió después de la voz
    segments: list[SegmentVoice]
    word_count: int
    subtitles: list[str]
    default_voice: str
    whisper_model: str


# --- utilidades ---


def _rel(path: Path) -> str:
    return path.relative_to(get_paths().home).as_posix()


def _abs(rel: str) -> Path:
    return get_paths().home / rel


def latest_track(session: Session, project_id: int) -> VoiceTrack | None:
    return session.exec(
        select(VoiceTrack)
        .where(VoiceTrack.project_id == project_id)
        .order_by(col(VoiceTrack.id).desc())
    ).first()


def _data(track: VoiceTrack | None) -> dict:
    return json.loads(track.transcript_json) if track and track.transcript_json else {}


def _current_hashes(session: Session, project_id: int) -> dict[str, str]:
    if not current_version(session, project_id):
        return {}
    return {s.seg_key: text_hash(s.text) for s in read_script(session, project_id).segments}


def real_segment_timings(
    session: Session, project_id: int
) -> dict[str, tuple[float, float, str]] | None:
    """Tiempos reales vigentes por segmento, o None si no hay voz o el guion cambió después."""
    track = latest_track(session, project_id)
    data = _data(track)
    if not data.get("timings") or data.get("hashes") != _current_hashes(session, project_id):
        return None
    source = data.get("timing_source", "voice")
    return {t["seg_key"]: (t["start_s"], t["end_s"], source) for t in data["timings"]}


def _script_ready(session: Session, project: Project) -> str | None:
    if ORDER.index(project.status) < ORDER.index(ProjectStatus.GUION_APROBADO):
        return "Aprueba el guion antes de grabar o generar la voz"
    version = current_version(session, project.id)
    if not version or version.status != "approved":
        return "El guion está desbloqueado: apruébalo para trabajar la voz"
    return None


def _require_ready(session: Session, project: Project) -> None:
    reason = _script_ready(session, project)
    if reason:
        raise Conflict(reason)


def _default_voice(session: Session, project: Project) -> str:
    channel = get_channel(session, project.channel_id)
    return channel.default_voice or load_settings().tts_voice or models.DEFAULT_VOICE


def voice_state(session: Session, project_id: int) -> VoiceState:
    project = get_project(session, project_id)
    track = latest_track(session, project_id)
    data = _data(track)
    reason = _script_ready(session, project)
    hashes = _current_hashes(session, project_id)
    script = read_script(session, project_id).segments if hashes else []
    timings = {t["seg_key"]: t for t in data.get("timings", [])}
    seg_files = data.get("segment_files", {})
    stale = bool(track) and data.get("hashes") != hashes
    subs_dir = project_dir(project) / "subs"
    return VoiceState(
        project_id=project_id,
        can_edit=reason is None,
        reason=reason,
        source=track.source if track else None,
        voice_id=data.get("voice_id"),
        speed=data.get("speed"),
        duration_s=track.duration_s if track else None,
        audio_url=f"/api/projects/{project_id}/voice/audio" if track else None,
        timing_source=data.get("timing_source") if timings and not stale else None,
        stale=stale,
        segments=[
            SegmentVoice(
                seg_key=s.seg_key,
                text=s.text,
                start_s=timings.get(s.seg_key, {}).get("start_s"),
                end_s=timings.get(s.seg_key, {}).get("end_s"),
                audio_url=(
                    f"/api/projects/{project_id}/voice/segments/{s.seg_key}/audio"
                    if s.seg_key in seg_files
                    else None
                ),
            )
            for s in script
        ],
        word_count=len(data.get("words", [])),
        subtitles=[p.name for p in (subs_dir / "voz.srt", subs_dir / "voz.vtt") if p.exists()],
        default_voice=_default_voice(session, project),
        whisper_model=load_settings().whisper_model,
    )


# --- escritura común ---


def _save_track(
    session: Session, project: Project, source: str, audio: Path, data: dict
) -> VoiceTrack:
    """Una sola voz vigente por proyecto: la anterior se reemplaza."""
    session.exec(delete(VoiceTrack).where(col(VoiceTrack.project_id) == project.id))
    info = process.video_info(audio)  # ffprobe también da la duración de un audio
    duration = info.duration_s
    if duration is None and audio.suffix.lower() == ".wav":
        try:
            with wave.open(str(audio)) as wf:
                duration = round(wf.getnframes() / wf.getframerate(), 2)
        except (wave.Error, EOFError):
            duration = None  # WAV dañado: Whisper dirá si hay voz
    track = VoiceTrack(
        project_id=project.id,
        source=source,
        file_path=_rel(audio),
        duration_s=duration,
        transcript_json=json.dumps(data, ensure_ascii=False),
        created_at=now_iso(),
    )
    session.add(track)
    session.flush()
    return track


def _apply(session: Session, project: Project, data: dict) -> None:
    """Tiempos reales a las escenas, subtítulos y, si corresponde, estado VOZ_LISTA."""
    from ..scenes import recompute_timings  # import local: scenes depende de voice

    recompute_timings(session, project.id)
    subs = project_dir(project) / "subs"
    subs.mkdir(parents=True, exist_ok=True)
    if data.get("words"):
        cues = cues_from_words([Word(**w) for w in data["words"]])
    else:
        texts = {s.seg_key: s.text for s in read_script(session, project.id).segments}
        timings = [SegmentTiming(**t) for t in data.get("timings", [])]
        cues = cues_from_segments(timings, texts)
    if cues:
        (subs / "voz.srt").write_text(to_srt(cues), encoding="utf-8")
        (subs / "voz.vtt").write_text(to_vtt(cues), encoding="utf-8")
    if project.status == ProjectStatus.MEDIOS_APROBADOS and data.get("timings"):
        project.status = ProjectStatus.VOZ_LISTA
    project.updated_at = now_iso()


# --- voz generada (Piper) ---


def concat_wavs(files: list[Path], out: Path, pause_s: float) -> list[tuple[float, float]]:
    """Une los WAV por segmento con una pausa entre ellos; devuelve (inicio, fin) de cada uno."""
    spans: list[tuple[float, float]] = []
    params = None
    frames_written = 0
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as dst:
        for i, path in enumerate(files):
            with wave.open(str(path)) as src:
                if params is None:
                    params = src.getparams()
                    dst.setparams(params)
                elif (src.getframerate(), src.getnchannels(), src.getsampwidth()) != (
                    params.framerate,
                    params.nchannels,
                    params.sampwidth,
                ):
                    raise DomainError("Los audios de los segmentos tienen formatos distintos")
                if i > 0 and pause_s > 0:
                    silence = int(params.framerate * pause_s)
                    dst.writeframes(b"\x00" * silence * params.sampwidth * params.nchannels)
                    frames_written += silence
                start = frames_written / params.framerate
                frames = src.readframes(src.getnframes())
                dst.writeframes(frames)
                frames_written += src.getnframes()
                spans.append((round(start, 2), round(frames_written / params.framerate, 2)))
    return spans


async def generate_voice(
    session_factory,
    project_id: int,
    voice_id: str | None,
    speed: float,
    pause_s: float,
    ctx: JobContext,
    only_segment: str | None = None,
) -> dict:
    with session_factory() as session:
        project = get_project(session, project_id)
        _require_ready(session, project)
        segments = [(s.seg_key, s.text) for s in read_script(session, project_id).segments]
        previous = _data(latest_track(session, project_id))
        if only_segment:
            if latest_track(session, project_id) is None or previous.get("voice_id") is None:
                raise Conflict("Primero genera la voz completa")
            if only_segment not in dict(segments):
                raise NotFound(f"No existe el segmento {only_segment}")
            voice_id, speed = previous["voice_id"], previous.get("speed", 1.0)
            pause_s = previous.get("pause_s", DEFAULT_PAUSE_S)
        voice_id = voice_id or _default_voice(session, project)
        audio_dir = project_dir(project) / "audio"

    model = await models.ensure_voice(voice_id, ctx)
    synth = await asyncio.to_thread(engines.synthesizer_factory, model)
    seg_dir = audio_dir / "segments"
    old_files = previous.get("segment_files", {}) if only_segment else {}
    files: list[Path] = []
    for i, (seg_key, text) in enumerate(segments):
        path = seg_dir / f"{seg_key}.wav"
        reuse = only_segment and seg_key != only_segment and seg_key in old_files and path.exists()
        if not reuse:
            ctx.progress(
                0.1 + 0.8 * i / len(segments),
                f"Generando la voz: segmento {i + 1} de {len(segments)}…",
            )
            await asyncio.to_thread(synth.synthesize, text, path, speed)
        files.append(path)

    ctx.progress(0.92, "Uniendo la voz y aplicando los tiempos reales…")
    out = audio_dir / "voz.wav"
    spans = await asyncio.to_thread(concat_wavs, files, out, pause_s)
    data = {
        "voice_id": voice_id,
        "speed": speed,
        "pause_s": pause_s,
        "timing_source": "voice",
        "timings": [
            {"seg_key": k, "start_s": s, "end_s": e}
            for (k, _t), (s, e) in zip(segments, spans, strict=True)
        ],
        "segment_files": {k: _rel(seg_dir / f"{k}.wav") for k, _ in segments},
        "hashes": {k: text_hash(t) for k, t in segments},
    }
    with session_factory() as session:
        project = get_project(session, project_id)
        track = _save_track(session, project, "piper", out, data)
        _apply(session, project, data)
        log_operation(
            session,
            "generate",
            "voice",
            project_id,
            {"voice": voice_id, "segment": only_segment},
            actor="system",
        )
        session.commit()
        return {"duration_s": track.duration_s, "segments": len(segments), "voice_id": voice_id}


# --- voz grabada ---


def upload_voice(session: Session, project_id: int, source: Path, original_name: str) -> VoiceState:
    project = get_project(session, project_id)
    _require_ready(session, project)
    ext = Path(original_name).suffix.lower()
    if ext not in AUDIO_EXT:
        raise DomainError("Formato de audio no admitido: usa WAV, MP3, M4A, AAC, OGG o FLAC")
    target = project_dir(project) / "audio" / f"voz_grabada{ext}"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), target)
    data = {
        "timing_source": None,
        "timings": [],
        "hashes": _current_hashes(session, project_id),
        "original_name": original_name,
    }
    _save_track(session, project, "recorded", target, data)
    from ..scenes import recompute_timings

    recompute_timings(session, project_id)  # vuelven los estimados hasta transcribir
    log_operation(session, "upload", "voice", project_id, {"file": original_name})
    session.commit()
    return voice_state(session, project_id)


# --- transcripción (Whisper) ---


async def transcribe_voice(session_factory, project_id: int, ctx: JobContext) -> dict:
    with session_factory() as session:
        project = get_project(session, project_id)
        _require_ready(session, project)
        track = latest_track(session, project_id)
        if not track:
            raise Conflict("Primero genera o sube la voz")
        audio = _abs(track.file_path)
        segments = [(s.seg_key, s.text) for s in read_script(session, project_id).segments]
        language = get_channel(session, project.channel_id).language
        size = load_settings().whisper_model
        data = _data(track)

    model_dir = await models.ensure_whisper(size, ctx)
    ctx.progress(0.3, "Whisper está escuchando la voz…")
    transcriber = await asyncio.to_thread(engines.transcriber_factory, model_dir)
    words = await asyncio.to_thread(transcriber.transcribe, audio, language)
    if not words:
        raise DomainError("Whisper no encontró voz en el audio")

    ctx.progress(0.9, "Alineando con el guion…")
    timings = align_segments(segments, words)
    data.update(
        timing_source="whisper",
        timings=[{"seg_key": t.seg_key, "start_s": t.start_s, "end_s": t.end_s} for t in timings],
        words=[{"text": w.text, "start": w.start, "end": w.end} for w in words],
        hashes={k: text_hash(t) for k, t in segments},
        whisper_model=size,
    )
    with session_factory() as session:
        project = get_project(session, project_id)
        track = latest_track(session, project_id)
        track.transcript_json = json.dumps(data, ensure_ascii=False)
        _apply(session, project, data)
        log_operation(
            session, "transcribe", "voice", project_id, {"words": len(words)}, actor="system"
        )
        session.commit()
    return {"words": len(words), "segments": len(timings)}


# --- archivos ---


def audio_file(session: Session, project_id: int, seg_key: str | None = None) -> Path:
    track = latest_track(session, project_id)
    if not track:
        raise NotFound("El proyecto no tiene voz")
    rel = _data(track).get("segment_files", {}).get(seg_key) if seg_key else track.file_path
    if not rel or not _abs(rel).exists():
        raise NotFound("El audio no está en disco")
    return _abs(rel)


def delete_voice_data(session: Session, project_id: int) -> None:
    session.exec(delete(VoiceTrack).where(col(VoiceTrack.project_id) == project_id))
