"""Guion por segmentos con versiones (sección 5.3 de SPEC.md).

- Cada guardado crea una versión; la última es la vigente y las anteriores quedan `superseded`.
- Los seg_key (seg_001…) son estables y nunca se reutilizan dentro de un proyecto: vinculan
  cada segmento con sus escenas.
- Al guardar, las escenas cuyos segmentos cambiaron o desaparecieron pasan a `review`
  (regla de propagación, sección 2).
"""

import hashlib
import re
from datetime import date

from sqlmodel import Session, col, delete, select

from ..domain.states import ORDER, ProjectStatus
from ..models import Channel, Project, Scene, ScriptVersion, Segment
from ..models._base import now_iso
from ..schemas.script import (
    GuionClaude,
    ReescrituraClaude,
    RewriteResult,
    ScriptRead,
    SegmentIn,
    SegmentRead,
    UnlockResult,
    VersionSummary,
)
from . import prompts
from .channels import get_channel
from .errors import Conflict, DomainError, NotFound
from .jobs import JobContext
from .llm.claude_cli import ClaudeRunner, generate_structured
from .oplog import log_operation
from .projects import get_project, index_fts, project_dir

EDITABLE = (ProjectStatus.IDEA, ProjectStatus.GUION_BORRADOR)
WORD_RE = re.compile(r"\w+", re.UNICODE)


# --- utilidades ---


def count_words(text: str) -> int:
    return len(WORD_RE.findall(text))


def estimate_duration(text: str, words_per_second: float) -> float:
    return round(count_words(text) / words_per_second, 1)


def text_hash(text: str) -> str:
    return hashlib.sha1(text.strip().encode("utf-8")).hexdigest()


def template_sections(channel: Channel) -> list[str]:
    raw = channel.script_template or ""
    return [s.strip().lower() for s in raw.split(",") if s.strip()]


def _seg_number(seg_key: str) -> int:
    match = re.fullmatch(r"seg_(\d+)", seg_key)
    return int(match.group(1)) if match else 0


# --- lectura ---


def _versions(session: Session, project_id: int) -> list[ScriptVersion]:
    return list(
        session.exec(
            select(ScriptVersion)
            .where(ScriptVersion.project_id == project_id)
            .order_by(col(ScriptVersion.version).desc())
        ).all()
    )


def current_version(session: Session, project_id: int) -> ScriptVersion | None:
    versions = _versions(session, project_id)
    return versions[0] if versions else None


def _segments(session: Session, version: ScriptVersion) -> list[Segment]:
    return list(
        session.exec(
            select(Segment)
            .where(Segment.script_version_id == version.id)
            .order_by(col(Segment.position))
        ).all()
    )


def _to_read(session: Session, project: Project, version: ScriptVersion) -> ScriptRead:
    channel = get_channel(session, project.channel_id)
    segments = _segments(session, version)
    return ScriptRead(
        project_id=project.id,
        version=version.version,
        status=version.status,
        source=version.source,
        created_at=version.created_at,
        segments=[
            SegmentRead(
                seg_key=s.seg_key,
                position=s.position,
                section=s.section,
                text=s.text,
                est_duration_s=s.est_duration_s or 0.0,
                needs_fact_check=bool(s.needs_fact_check),
            )
            for s in segments
        ],
        word_count=sum(count_words(s.text) for s in segments),
        total_est_s=round(sum(s.est_duration_s or 0.0 for s in segments), 1),
        target_duration_s=project.target_duration_s,
        words_per_second=channel.words_per_second,
        sections=template_sections(channel),
    )


def read_script(session: Session, project_id: int, version: int | None = None) -> ScriptRead:
    project = get_project(session, project_id)
    versions = _versions(session, project_id)
    if not versions:
        raise NotFound("El proyecto todavía no tiene guion")
    if version is None:
        return _to_read(session, project, versions[0])
    for v in versions:
        if v.version == version:
            return _to_read(session, project, v)
    raise NotFound(f"No existe la versión {version} del guion")


def list_versions(session: Session, project_id: int) -> list[VersionSummary]:
    get_project(session, project_id)
    summaries = []
    for v in _versions(session, project_id):
        segments = _segments(session, v)
        summaries.append(
            VersionSummary(
                version=v.version,
                status=v.status,
                source=v.source,
                created_at=v.created_at,
                segment_count=len(segments),
                word_count=sum(count_words(s.text) for s in segments),
                total_est_s=round(sum(s.est_duration_s or 0.0 for s in segments), 1),
            )
        )
    return summaries


# --- escritura ---


def _max_seg_number(session: Session, project_id: int) -> int:
    keys = session.exec(
        select(Segment.seg_key)
        .join(ScriptVersion, col(ScriptVersion.id) == Segment.script_version_id)
        .where(ScriptVersion.project_id == project_id)
    ).all()
    return max((_seg_number(k) for k in keys), default=0)


def _same_content(segments: list[Segment], incoming: list[SegmentIn]) -> bool:
    if len(segments) != len(incoming):
        return False
    return all(
        s.seg_key == i.seg_key
        and s.text == i.text.strip()
        and (s.section or None) == (i.section or None)
        and bool(s.needs_fact_check) == i.needs_fact_check
        for s, i in zip(segments, incoming, strict=True)
    )


def _assign_keys(
    session: Session, project_id: int, incoming: list[SegmentIn], known: set[str]
) -> list[str]:
    """Conserva las claves conocidas; asigna claves nuevas a los segmentos sin clave,
    con clave desconocida o repetida (p. ej. texto pegado o un segmento dividido)."""
    next_number = _max_seg_number(session, project_id) + 1
    used: set[str] = set()
    keys: list[str] = []
    for seg in incoming:
        key = seg.seg_key
        if not key or key not in known or key in used:
            key = f"seg_{next_number:03d}"
            next_number += 1
        used.add(key)
        keys.append(key)
    return keys


def _mark_scenes_for_review(session: Session, project_id: int, seg_keys: set[str]) -> int:
    if not seg_keys:
        return 0
    scenes = session.exec(
        select(Scene).where(Scene.project_id == project_id, col(Scene.seg_key).in_(seg_keys))
    ).all()
    for scene in scenes:
        scene.status = "review"
    return len(scenes)


def save_script(
    session: Session,
    project_id: int,
    incoming: list[SegmentIn],
    source: str = "manual",
    actor: str = "ui",
) -> ScriptRead:
    project = get_project(session, project_id)
    if project.status not in EDITABLE:
        raise Conflict("El guion está aprobado: desbloquéalo para editarlo")
    if not incoming:
        raise DomainError("El guion no puede quedar vacío")

    channel = get_channel(session, project.channel_id)
    previous = current_version(session, project_id)
    previous_segments = _segments(session, previous) if previous else []

    if previous and _same_content(previous_segments, incoming):
        return _to_read(session, project, previous)  # sin cambios: no se crea versión

    known = {
        k
        for k in session.exec(
            select(Segment.seg_key)
            .join(ScriptVersion, col(ScriptVersion.id) == Segment.script_version_id)
            .where(ScriptVersion.project_id == project_id)
        ).all()
    }
    keys = _assign_keys(session, project_id, incoming, known)

    if previous:
        previous.status = "superseded"
    version = ScriptVersion(
        project_id=project_id,
        version=(previous.version + 1) if previous else 1,
        status="draft",
        source=source,
    )
    session.add(version)
    session.flush()

    new_hashes: dict[str, str] = {}
    for position, (seg, key) in enumerate(zip(incoming, keys, strict=True), start=1):
        body = seg.text.strip()
        new_hashes[key] = text_hash(body)
        session.add(
            Segment(
                script_version_id=version.id,
                seg_key=key,
                position=position,
                section=(seg.section or "").strip().lower() or None,
                text=body,
                text_hash=new_hashes[key],
                est_duration_s=estimate_duration(body, channel.words_per_second),
                needs_fact_check=int(seg.needs_fact_check),
            )
        )

    changed = {s.seg_key for s in previous_segments if new_hashes.get(s.seg_key) != s.text_hash}
    _mark_scenes_for_review(session, project_id, changed)

    if project.status == ProjectStatus.IDEA:
        project.status = ProjectStatus.GUION_BORRADOR
    project.updated_at = now_iso()
    index_fts(session, project, script_text="\n".join(s.text.strip() for s in incoming))
    log_operation(
        session,
        "save",
        "script",
        project_id,
        {"version": version.version, "source": source, "segments": len(incoming)},
        actor=actor,
    )
    session.commit()
    return _to_read(session, project, version)


def restore_version(session: Session, project_id: int, version_number: int) -> ScriptRead:
    old = read_script(session, project_id, version_number)
    incoming = [
        SegmentIn(
            seg_key=s.seg_key,
            section=s.section,
            text=s.text,
            needs_fact_check=s.needs_fact_check,
        )
        for s in old.segments
    ]
    return save_script(session, project_id, incoming, source=f"restore:v{version_number}")


def approve_script(session: Session, project_id: int) -> ScriptRead:
    project = get_project(session, project_id)
    version = current_version(session, project_id)
    if not version:
        raise Conflict("No hay guion para aprobar")
    if project.status != ProjectStatus.GUION_BORRADOR:
        raise Conflict("El guion ya está aprobado")

    version.status = "approved"
    project.status = ProjectStatus.GUION_APROBADO
    project.updated_at = now_iso()
    _write_script_md(project, _segments(session, version))
    log_operation(session, "approve", "script", project_id, {"version": version.version})
    session.commit()
    return _to_read(session, project, version)


def unlock_script(session: Session, project_id: int) -> UnlockResult:
    project = get_project(session, project_id)
    if ORDER.index(project.status) < ORDER.index(ProjectStatus.GUION_APROBADO):
        raise Conflict("El guion no está aprobado")
    version = current_version(session, project_id)
    if version:
        version.status = "draft"
    project.status = ProjectStatus.GUION_BORRADOR
    project.updated_at = now_iso()
    scenes = session.exec(select(Scene).where(Scene.project_id == project_id)).all()
    log_operation(session, "unlock", "script", project_id, {"scenes": len(scenes)})
    session.commit()
    # Las escenas se marcan para revisar solo si su segmento cambia al guardar (propagación).
    return UnlockResult(scenes_to_review=len(scenes))


def delete_script_data(session: Session, project_id: int) -> None:
    """Borra versiones y segmentos (al eliminar el proyecto)."""
    version_ids = [v.id for v in _versions(session, project_id)]
    if version_ids:
        session.exec(delete(Segment).where(col(Segment.script_version_id).in_(version_ids)))
        session.exec(delete(ScriptVersion).where(col(ScriptVersion.project_id) == project_id))


def _write_script_md(project: Project, segments: list[Segment]) -> None:
    """guion.md en la carpeta del proyecto: versión aprobada, legible fuera de la app."""
    lines = [f"# {project.title}", ""]
    section = None
    for seg in segments:
        if seg.section and seg.section != section:
            section = seg.section
            lines += [f"## {section.capitalize()}", ""]
        mark = " ⚠ verificar dato" if seg.needs_fact_check else ""
        lines += [f"{seg.text}{mark}", ""]
    (project_dir(project) / "guion.md").write_text("\n".join(lines), encoding="utf-8")


# --- Claude ---

FORMAT_TEXT = {"video": ("video", "16:9 horizontal"), "reel": ("reel / short", "9:16 vertical")}


def _duration_text(seconds: int) -> str:
    return f"{seconds // 60} min {seconds % 60} s" if seconds >= 60 else f"{seconds} s"


def build_script_prompt(project: Project, channel: Channel) -> str:
    target = project.target_duration_s or 600
    formato, relacion = FORMAT_TEXT[project.format]
    return prompts.render(
        prompts.load_prompt("guion"),
        canal=channel.name,
        estilo=channel.style_prompt or "Claro y directo.",
        formato=formato,
        relacion=relacion,
        duracion=_duration_text(target),
        duracion_s=target,
        palabras_objetivo=round(target * channel.words_per_second),
        estructura=", ".join(template_sections(channel)) or "libre",
        idioma=channel.language,
        titulo=project.title,
        tema=project.topic or project.title,
        notas=project.research_notes or "(sin notas: marca como verificar_dato todo dato concreto)",
        fecha=date.today().isoformat(),
    )


async def generate_script(
    session_factory, project_id: int, runner: ClaudeRunner, ctx: JobContext
) -> dict:
    """Trabajo en segundo plano: pide el guion a Claude y lo guarda como nueva versión."""
    with session_factory() as session:
        project = get_project(session, project_id)
        if project.status not in EDITABLE:
            raise Conflict("El guion está aprobado: desbloquéalo para regenerarlo")
        channel = get_channel(session, project.channel_id)
        prompt = build_script_prompt(project, channel)
        cwd = project_dir(project)

    ctx.progress(0.1, "Claude está escribiendo el guion…")
    guion = await generate_structured(runner, prompt, GuionClaude, cwd=cwd)

    ctx.progress(0.9, "Guardando el guion…")
    with session_factory() as session:
        saved = save_script(
            session,
            project_id,
            [
                SegmentIn(section=s.seccion, text=s.texto, needs_fact_check=s.verificar_dato)
                for s in guion.segmentos
            ],
            source="claude",
            actor="system",
        )
    return {
        "version": saved.version,
        "segments": len(saved.segments),
        "titulo_sugerido": guion.titulo_tentativo,
        "fuentes_sugeridas": guion.fuentes_sugeridas,
    }


async def rewrite_fragment(
    session: Session,
    project_id: int,
    seg_key: str,
    instruction: str,
    fragment: str | None,
    runner: ClaudeRunner,
) -> RewriteResult:
    project = get_project(session, project_id)
    if project.status not in EDITABLE:
        raise Conflict("El guion está aprobado: desbloquéalo para editarlo")
    script = read_script(session, project_id)
    segment = next((s for s in script.segments if s.seg_key == seg_key), None)
    if not segment:
        raise NotFound(f"No existe el segmento {seg_key} en la versión actual")
    target = (fragment or segment.text).strip()
    if target not in segment.text:
        raise DomainError("El fragmento no está en el texto guardado del segmento: guarda antes")

    channel = get_channel(session, project.channel_id)
    prompt = prompts.render(
        prompts.load_prompt("reescribir_segmento"),
        canal=channel.name,
        estilo=channel.style_prompt or "Claro y directo.",
        idioma=channel.language,
        guion="\n".join(s.text for s in script.segments),
        notas=project.research_notes or "(sin notas)",
        fragmento=target,
        instruccion=instruction.strip(),
    )
    result = await generate_structured(runner, prompt, ReescrituraClaude, cwd=project_dir(project))
    return RewriteResult(
        seg_key=seg_key,
        fragmento=target,
        texto=result.texto.strip().strip('"').strip(),
        verificar_dato=result.verificar_dato,
    )
