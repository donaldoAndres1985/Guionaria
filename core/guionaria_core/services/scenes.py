"""Tabla de escenas (sección 5.4 de SPEC.md).

- Claude propone las escenas a partir del guion aprobado; la app valida las reglas de la
  sección 11.2 y calcula los tiempos (Claude nunca los genera).
- Tiempos estimados: la duración de cada segmento se reparte en partes iguales entre sus
  escenas, en el orden de la tabla.
- Propagación: las escenas de segmentos cambiados quedan en `review`; "regenerar pendientes"
  rehace solo esas y las de segmentos sin escenas, y conserva el resto.
"""

import csv
import io
import json

from sqlmodel import Session, col, delete, select

from ..domain.states import ORDER, ProjectStatus
from ..models import Channel, Project, Scene
from ..models._base import now_iso
from ..schemas.scene import (
    EFFECTS,
    KIND_FROM_TIPO,
    TIPO_FROM_KIND,
    EscenaClaude,
    EscenasClaude,
    ExportResult,
    SceneRead,
    ScenesRead,
    SceneUpdate,
)
from ..schemas.script import ScriptRead, SegmentRead
from . import prompts
from .channels import get_channel
from .errors import Conflict, DomainError, NotFound
from .jobs import JobContext
from .llm.claude_cli import ClaudeRunner, generate_structured
from .oplog import log_operation
from .projects import get_project, project_dir
from .script import current_version, read_script

EDITABLE = (ProjectStatus.GUION_APROBADO, ProjectStatus.ESCENAS_BORRADOR)
MAX_SCENE_S = {"video": 8, "reel": 4}
FALLBACK_SEGMENT_S = 2.0  # escenas cuyo segmento ya no existe


# --- lectura ---


def _scenes(session: Session, project_id: int) -> list[Scene]:
    return list(
        session.exec(
            select(Scene).where(Scene.project_id == project_id).order_by(col(Scene.position))
        ).all()
    )


def _current_segments(session: Session, project_id: int) -> list[SegmentRead]:
    if not current_version(session, project_id):
        return []
    return read_script(session, project_id).segments


def _to_read(scene: Scene, known_keys: set[str]) -> SceneRead:
    return SceneRead(
        id=scene.id,
        seg_key=scene.seg_key,
        position=scene.position,
        start_s=scene.start_s,
        end_s=scene.end_s,
        timing_source=scene.timing_source,
        narration=scene.narration,
        media_kind=scene.media_kind,
        visual_description=scene.visual_description,
        query_en=scene.query_en,
        query_alt=scene.query_alt,
        query_real=scene.query_real,
        effect=scene.effect,
        on_screen_text=scene.on_screen_text,
        sfx=scene.sfx,
        music_cue=scene.music_cue,
        status=scene.status,
        approved_asset_id=scene.approved_asset_id,
        sfx_sound_id=scene.sfx_sound_id,
        music_sound_id=scene.music_sound_id,
        segment_missing=scene.seg_key not in known_keys,
    )


def list_scenes(session: Session, project_id: int) -> ScenesRead:
    project = get_project(session, project_id)
    scenes = _scenes(session, project_id)
    segments = _current_segments(session, project_id)
    keys = {s.seg_key for s in segments}
    covered = {s.seg_key for s in scenes}
    return ScenesRead(
        project_id=project_id,
        editable=project.status in EDITABLE,
        approved=ORDER.index(project.status) >= ORDER.index(ProjectStatus.ESCENAS_APROBADAS),
        scenes=[_to_read(s, keys) for s in scenes],
        total_s=round(max((s.end_s or 0.0 for s in scenes), default=0.0), 1),
        review_count=sum(1 for s in scenes if s.status == "review" or s.seg_key not in keys),
        segments_without_scenes=[s.seg_key for s in segments if s.seg_key not in covered]
        if scenes
        else [],
    )


def get_scene(session: Session, scene_id: int) -> Scene:
    scene = session.get(Scene, scene_id)
    if not scene:
        raise NotFound("La escena no existe")
    return scene


# --- tiempos ---


def recompute_timings(session: Session, project_id: int) -> None:
    """Reparte la duración estimada de cada segmento entre sus escenas y acumula los tiempos
    en el orden de la tabla. También refresca la narración con el texto vigente del segmento."""
    segments = {s.seg_key: s for s in _current_segments(session, project_id)}
    scenes = _scenes(session, project_id)
    per_segment: dict[str, int] = {}
    for scene in scenes:
        per_segment[scene.seg_key] = per_segment.get(scene.seg_key, 0) + 1

    t = 0.0
    for position, scene in enumerate(scenes, start=1):
        segment = segments.get(scene.seg_key)
        seg_duration = segment.est_duration_s if segment else FALLBACK_SEGMENT_S
        duration = seg_duration / per_segment[scene.seg_key]
        scene.position = position
        scene.start_s = round(t, 2)
        t += duration
        scene.end_s = round(t, 2)
        scene.timing_source = "estimated"
        if segment:
            scene.narration = segment.text

    # Con voz vigente (generada o transcrita), cada segmento toma su tiempo real y lo reparte
    # entre sus escenas (sección 5.9). Imports locales: voice y media dependen de scenes.
    from .voice.service import real_segment_timings

    real = real_segment_timings(session, project_id)
    if real:
        by_segment: dict[str, list[Scene]] = {}
        for scene in scenes:
            by_segment.setdefault(scene.seg_key, []).append(scene)
        for seg_key, (start, end, source) in real.items():
            group = by_segment.get(seg_key, [])
            step = (end - start) / len(group) if group else 0
            for i, scene in enumerate(group):
                scene.start_s = round(start + step * i, 2)
                scene.end_s = round(start + step * (i + 1), 2)
                scene.timing_source = source

    from .media.service import sync_approved_names

    session.flush()
    sync_approved_names(session, project_id)  # los nombres llevan número de escena e inicio


# --- permisos ---


def _editable_project(session: Session, project_id: int) -> Project:
    project = get_project(session, project_id)
    if project.status not in EDITABLE:
        if ORDER.index(project.status) < ORDER.index(ProjectStatus.GUION_APROBADO):
            raise Conflict("Aprueba el guion antes de trabajar las escenas")
        raise Conflict("Las escenas están aprobadas: desbloquéalas para editarlas")
    return project


def _approved_script(session: Session, project: Project) -> ScriptRead:
    version = current_version(session, project.id)
    if not version or version.status != "approved":
        raise Conflict("Aprueba el guion antes de generar las escenas")
    return read_script(session, project.id)


# --- generación con Claude ---


def _validate(escenas: EscenasClaude, targets: list[str]) -> None:
    """Reglas de la sección 11.2. Un ValueError hace que se reintente con el error adjunto."""
    problems: list[str] = []
    target_set = set(targets)
    for i, e in enumerate(escenas.escenas, start=1):
        if e.seg_key not in target_set:
            problems.append(f"escena {i}: seg_key '{e.seg_key}' no es uno de los pedidos")
        if e.tipo in ("video", "imagen") and not e.busqueda_en.strip():
            problems.append(f"escena {i}: busqueda_en es obligatoria para tipo {e.tipo}")
        if e.tipo == "real" and not e.busqueda_real.strip():
            problems.append(f"escena {i}: busqueda_real es obligatoria para tipo real")
    missing = target_set - {e.seg_key for e in escenas.escenas}
    if missing:
        problems.append(f"faltan escenas para: {', '.join(sorted(missing))}")
    if problems:
        raise ValueError("; ".join(problems))


def build_scenes_prompt(
    project: Project, channel: Channel, segments: list[SegmentRead], partial: bool
) -> str:
    formato, relacion = {
        "video": ("video", "16:9 horizontal"),
        "reel": ("reel / short", "9:16 vertical"),
    }[project.format]
    guion = "\n".join(
        f"{s.seg_key} · {s.section or '-'} · ({s.est_duration_s:.1f} s) {s.text}" for s in segments
    )
    text = prompts.render(
        prompts.load_prompt("escenas"),
        canal=channel.name,
        formato=formato,
        relacion=relacion,
        max_escena_s=MAX_SCENE_S[project.format],
        lista_efectos=", ".join(EFFECTS),
        estilo=channel.style_prompt or "Claro y directo.",
        guion=guion,
    )
    if partial:
        text += (
            "\n\nIMPORTANTE: el resto del guion ya tiene escenas. Genera escenas SOLO para los "
            "segmentos listados arriba."
        )
    return text


def _pending_targets(scenes: list[Scene], segments: list[SegmentRead]) -> list[str]:
    covered = {s.seg_key for s in scenes}
    review = {s.seg_key for s in scenes if s.status == "review"}
    return [s.seg_key for s in segments if s.seg_key not in covered or s.seg_key in review]


def _new_scene(project_id: int, e: EscenaClaude) -> Scene:
    return Scene(
        project_id=project_id,
        seg_key=e.seg_key,
        position=0,
        media_kind=KIND_FROM_TIPO[e.tipo],
        visual_description=e.descripcion_visual.strip(),
        query_en=e.busqueda_en.strip() or None,
        query_alt=e.busqueda_alt.strip() or None,
        query_real=e.busqueda_real.strip() or None,
        effect=e.efecto,
        on_screen_text=e.texto_pantalla.strip() or None,
        sfx=e.sfx.strip() or None,
        music_cue=e.musica.strip() or None,
        status="pending",
    )


async def generate_scenes(
    session_factory, project_id: int, mode: str, runner: ClaudeRunner, ctx: JobContext
) -> dict:
    with session_factory() as session:
        project = _editable_project(session, project_id)
        script = _approved_script(session, project)
        channel = get_channel(session, project.channel_id)
        existing = _scenes(session, project_id)
        if mode == "pending" and existing:
            targets = _pending_targets(existing, script.segments)
            if not targets and not any(
                s.seg_key not in {x.seg_key for x in script.segments} for s in existing
            ):
                return {"created": 0, "total": len(existing)}
        else:
            targets = [s.seg_key for s in script.segments]
        target_segments = [s for s in script.segments if s.seg_key in set(targets)]
        prompt = build_scenes_prompt(project, channel, target_segments, partial=mode == "pending")
        cwd = project_dir(project)

    new: list[EscenaClaude] = []
    if target_segments:
        ctx.progress(0.1, f"Claude está armando las escenas de {len(target_segments)} segmentos…")
        result = await generate_structured(
            runner, prompt, EscenasClaude, cwd=cwd, check=lambda r: _validate(r, targets)
        )
        new = result.escenas

    ctx.progress(0.9, "Guardando las escenas…")
    with session_factory() as session:
        project = _editable_project(session, project_id)
        script = _approved_script(session, project)
        total = _store_scenes(session, project, script, mode, targets, new)
        log_operation(
            session,
            "generate",
            "scenes",
            project_id,
            {"mode": mode, "created": len(new)},
            actor="system",
        )
        session.commit()
        return {"created": len(new), "total": total}


def _store_scenes(
    session: Session,
    project: Project,
    script: ScriptRead,
    mode: str,
    targets: list[str],
    new: list[EscenaClaude],
) -> int:
    """Reemplaza las escenas de los segmentos pedidos (o todas) y recalcula los tiempos."""
    target_set = set(targets)
    current_keys = {s.seg_key for s in script.segments}
    keep: dict[str, list[Scene]] = {}
    drop: list[Scene] = []
    for scene in _scenes(session, project.id):
        if mode == "all" or scene.seg_key in target_set or scene.seg_key not in current_keys:
            drop.append(scene)  # regenerada o su segmento ya no existe
        else:
            keep.setdefault(scene.seg_key, []).append(scene)
    _drop_scenes(session, drop)

    fresh: dict[str, list[Scene]] = {}
    for e in new:
        fresh.setdefault(e.seg_key, []).append(_new_scene(project.id, e))

    # Orden final: el del guion; dentro de cada segmento, el recibido o el existente.
    position = 1
    for segment in script.segments:
        for scene in fresh.get(segment.seg_key) or keep.get(segment.seg_key, []):
            scene.position = position
            position += 1
            session.add(scene)
    session.flush()
    recompute_timings(session, project.id)
    project.status = ProjectStatus.ESCENAS_BORRADOR
    project.updated_at = now_iso()
    return position - 1


def save_scenes(
    session: Session, project_id: int, escenas: list[EscenaClaude], mode: str = "all"
) -> ScenesRead:
    """Escenas redactadas fuera de la app (Claude por MCP): mismas reglas que las generadas."""
    project = _editable_project(session, project_id)
    script = _approved_script(session, project)
    existing = _scenes(session, project_id)
    if mode == "pending" and existing:
        targets = _pending_targets(existing, script.segments)
    else:
        targets = [s.seg_key for s in script.segments]
    if not escenas:
        raise DomainError("Envía al menos una escena")
    try:
        _validate(EscenasClaude(escenas=escenas), targets)
    except ValueError as exc:
        raise DomainError(f"Escenas no válidas: {exc}") from exc
    _store_scenes(session, project, script, mode, targets, escenas)
    log_operation(session, "save", "scenes", project_id, {"mode": mode, "created": len(escenas)})
    session.commit()
    return list_scenes(session, project_id)


# --- edición ---


def update_scene(session: Session, scene_id: int, data: SceneUpdate) -> SceneRead:
    scene = get_scene(session, scene_id)
    _editable_project(session, scene.project_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        if key == "media_kind" and value is None:
            raise DomainError("El tipo de medio es obligatorio")
        setattr(scene, key, value)
    if scene.status == "review":
        scene.status = "pending"  # el usuario la revisó al editarla
    session.commit()
    keys = {s.seg_key for s in _current_segments(session, scene.project_id)}
    return _to_read(scene, keys)


def mark_reviewed(session: Session, scene_id: int) -> SceneRead:
    scene = get_scene(session, scene_id)
    _editable_project(session, scene.project_id)
    if scene.status == "review":
        scene.status = "pending"
    session.commit()
    keys = {s.seg_key for s in _current_segments(session, scene.project_id)}
    return _to_read(scene, keys)


def reorder_scenes(session: Session, project_id: int, scene_ids: list[int]) -> ScenesRead:
    _editable_project(session, project_id)
    scenes = {s.id: s for s in _scenes(session, project_id)}
    if sorted(scene_ids) != sorted(scenes):
        raise DomainError("La lista debe incluir todas las escenas del proyecto, una vez cada una")
    for position, sid in enumerate(scene_ids, start=1):
        scenes[sid].position = position
    session.flush()
    recompute_timings(session, project_id)
    session.commit()
    return list_scenes(session, project_id)


def _insert_after(session: Session, scene: Scene, copy: Scene) -> None:
    for other in _scenes(session, scene.project_id):
        if other.position > scene.position:
            other.position += 1
    copy.position = scene.position + 1
    session.add(copy)
    session.flush()
    recompute_timings(session, scene.project_id)


def _copy(scene: Scene, keep_content: bool) -> Scene:
    fields = scene.model_dump(exclude={"id", "position", "approved_asset_id", "status"})
    copy = Scene(**fields, position=0, status="pending")
    if not keep_content:
        copy.visual_description = None
    return copy


def split_scene(session: Session, scene_id: int) -> ScenesRead:
    """Divide la escena en dos: la nueva va detrás, con el mismo tipo y búsquedas y la
    descripción vacía; el tiempo del segmento se reparte entre ambas."""
    scene = get_scene(session, scene_id)
    _editable_project(session, scene.project_id)
    _insert_after(session, scene, _copy(scene, keep_content=False))
    session.commit()
    return list_scenes(session, scene.project_id)


def duplicate_scene(session: Session, scene_id: int) -> ScenesRead:
    scene = get_scene(session, scene_id)
    _editable_project(session, scene.project_id)
    _insert_after(session, scene, _copy(scene, keep_content=True))
    session.commit()
    return list_scenes(session, scene.project_id)


def _drop_scenes(session: Session, scenes: list[Scene]) -> None:
    from .media.service import delete_for_scenes  # import local: media depende de scenes

    delete_for_scenes(session, [s.id for s in scenes])
    for scene in scenes:
        session.delete(scene)
    session.flush()


def delete_scene(session: Session, scene_id: int) -> ScenesRead:
    scene = get_scene(session, scene_id)
    project_id = scene.project_id
    _editable_project(session, project_id)
    _drop_scenes(session, [scene])
    recompute_timings(session, project_id)
    session.commit()
    return list_scenes(session, project_id)


def delete_scene_data(session: Session, project_id: int) -> None:
    session.exec(delete(Scene).where(col(Scene.project_id) == project_id))


# --- aprobación ---


def approve_scenes(session: Session, project_id: int) -> ScenesRead:
    project = get_project(session, project_id)
    if project.status != ProjectStatus.ESCENAS_BORRADOR:
        raise Conflict(
            "Las escenas ya están aprobadas"
            if ORDER.index(project.status) > ORDER.index(ProjectStatus.ESCENAS_BORRADOR)
            else "Primero genera las escenas"
        )
    state = list_scenes(session, project_id)
    if not state.scenes:
        raise Conflict("No hay escenas para aprobar")
    if state.segments_without_scenes:
        raise Conflict(
            f"Hay segmentos sin escenas: {', '.join(state.segments_without_scenes)}. "
            "Usa «Regenerar pendientes»."
        )
    if state.review_count:
        raise Conflict(f"Hay {state.review_count} escenas por revisar")

    project.status = ProjectStatus.ESCENAS_APROBADAS
    project.updated_at = now_iso()
    _write_exports(project, state)
    log_operation(session, "approve", "scenes", project_id, {"scenes": len(state.scenes)})
    session.commit()
    return list_scenes(session, project_id)


def unlock_scenes(session: Session, project_id: int) -> ScenesRead:
    project = get_project(session, project_id)
    if ORDER.index(project.status) < ORDER.index(ProjectStatus.ESCENAS_APROBADAS):
        raise Conflict("Las escenas no están aprobadas")
    project.status = ProjectStatus.ESCENAS_BORRADOR
    project.updated_at = now_iso()
    log_operation(session, "unlock", "scenes", project_id)
    session.commit()
    return list_scenes(session, project_id)


# --- exportación ---

COLUMNS = [
    "#",
    "Inicio–Fin",
    "Narración",
    "Tipo",
    "Descripción visual",
    "Búsqueda EN",
    "Búsqueda alternativa",
    "Búsqueda real",
    "Efecto",
    "Texto en pantalla",
    "SFX",
    "Música",
]


def mmss(seconds: float | None) -> str:
    # Se trunca, como cualquier marca de tiempo (round() de Python redondea 2.5 a 2).
    s = int(seconds or 0)
    return f"{s // 60}:{s % 60:02d}"


def _row(scene: SceneRead) -> list[str]:
    return [
        str(scene.position),
        f"{mmss(scene.start_s)}–{mmss(scene.end_s)}",
        scene.narration or "",
        TIPO_FROM_KIND[scene.media_kind],
        scene.visual_description or "",
        scene.query_en or "",
        scene.query_alt or "",
        scene.query_real or "",
        scene.effect or "",
        scene.on_screen_text or "",
        scene.sfx or "",
        scene.music_cue or "",
    ]


def to_markdown(project: Project, state: ScenesRead) -> str:
    def cell(v: str) -> str:
        return v.replace("|", "\\|").replace("\n", " ")

    lines = [
        f"# Escenas — {project.title}",
        "",
        f"{len(state.scenes)} escenas · duración estimada {mmss(state.total_s)}",
        "",
        "| " + " | ".join(COLUMNS) + " |",
        "|" + "---|" * len(COLUMNS),
    ]
    lines += ["| " + " | ".join(cell(v) for v in _row(s)) + " |" for s in state.scenes]
    return "\n".join(lines) + "\n"


def to_csv(state: ScenesRead) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(COLUMNS)
    writer.writerows(_row(s) for s in state.scenes)
    return buffer.getvalue()


def to_json(project: Project, state: ScenesRead) -> dict:
    """escenas.json con el contrato de la sección 11.2 más los tiempos calculados."""
    return {
        "formato": project.format,
        "escenas": [
            {
                "seg_key": s.seg_key,
                "orden": s.position,
                "inicio_s": s.start_s,
                "fin_s": s.end_s,
                "tipo": TIPO_FROM_KIND[s.media_kind],
                "descripcion_visual": s.visual_description or "",
                "busqueda_en": s.query_en or "",
                "busqueda_alt": s.query_alt or "",
                "busqueda_real": s.query_real or "",
                "efecto": s.effect or "ninguno",
                "texto_pantalla": s.on_screen_text or "",
                "sfx": s.sfx or "",
                "musica": s.music_cue or "",
            }
            for s in state.scenes
        ],
    }


def _write_exports(project: Project, state: ScenesRead) -> None:
    folder = project_dir(project)
    (folder / "escenas.md").write_text(to_markdown(project, state), encoding="utf-8")
    (folder / "escenas.json").write_text(
        json.dumps(to_json(project, state), ensure_ascii=False, indent=2), encoding="utf-8"
    )


def export_scenes(session: Session, project_id: int, fmt: str) -> ExportResult:
    project = get_project(session, project_id)
    state = list_scenes(session, project_id)
    if not state.scenes:
        raise Conflict("No hay escenas para exportar")
    folder = project_dir(project)
    if fmt == "csv":
        path = folder / "escenas.csv"
        path.write_text(to_csv(state), encoding="utf-8-sig")  # con BOM: Excel lo abre bien
    else:
        path = folder / "escenas.md"
        path.write_text(to_markdown(project, state), encoding="utf-8")
    return ExportResult(format=fmt, path=str(path))
