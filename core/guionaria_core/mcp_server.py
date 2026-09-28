"""Servidor MCP (secciones 4.2 y 12 de SPEC.md): los mismos servicios de la app como herramientas.

- Por HTTP en http://127.0.0.1:8765/mcp (dentro del núcleo que lanza la app).
- Por stdio con `guionaria-core mcp` (Claude Desktop), en un proceso aparte con la misma base.

Claude redacta el guion y las escenas y los guarda con save_script / save_scenes: estas
herramientas nunca llaman a la CLI de Claude (evita el doble consumo del plan).
"""

import functools
import inspect
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from . import __version__
from .config import SubtitleStyle, TextStyle, load_settings
from .db import get_engine
from .domain.states import ProjectStatus
from .models import Channel, Scene
from .schemas.project import ProjectCreate
from .schemas.scene import EFFECTS, EscenaClaude, SceneUpdate
from .schemas.script import SegmentIn
from .services import channels, ideas, jobs, library, projects, script, sounds
from .services import scenes as scene_svc
from .services.errors import DomainError, NotFound
from .services.jobs import JobContext, JobRead
from .services.media import framing, manual, video_url
from .services.media import service as media
from .services.oplog import current_actor
from .services.package import _approved_by_scene, credits_text
from .services.timeline import service as timeline
from .services.voice import elevenlabs
from .services.voice import service as voice
from .services.voice.models import DEFAULT_VOICE

INSTRUCTIONS = """Guionaria convierte una idea en un video listo para editar, por etapas:
guion → escenas → medios → voz → timeline → render. Cada etapa se aprueba antes de pasar a la
siguiente. Tú redactas el guion y las escenas y los guardas con save_script y save_scenes: la app
no vuelve a llamar a Claude. Usa get_project para ver el estado y el paso siguiente.
Medios: busca con search_media, elige con choose_media (el primero es el principal) y baja todo
con download_and_approve; afina el momento exacto de un video con set_trim.
Voz: generate_voice con Piper (gratis) o ElevenLabs (list_elevenlabs_voices para elegir la voz).
Render: render_video con quality (draft, standard, high, max) y subtitle_preset (reel, clasico,
caja); cancel_job lo detiene. Las herramientas que devuelven un trabajo (job) corren en segundo
plano: consulta su avance con job_status. Escribe el guion y las escenas en el idioma del canal
(normalmente español). La revisión visual final conviene hacerla en la app."""

NEXT_STEP = {
    ProjectStatus.IDEA: (
        "Si el tema necesita datos, investígalo con research_project; después redacta el guion "
        "(save_script) y apruébalo (approve_script)."
    ),
    ProjectStatus.GUION_BORRADOR: "Revisa el guion (get_script) y apruébalo con approve_script.",
    ProjectStatus.GUION_APROBADO: "Redacta las escenas y guárdalas con save_scenes.",
    ProjectStatus.ESCENAS_BORRADOR: "Revisa las escenas y apruébalas con approve_scenes.",
    ProjectStatus.ESCENAS_APROBADAS: (
        "Para cada escena de list_pending: search_media y choose_media; después "
        "download_and_approve para bajar y aprobar todo junto."
    ),
    ProjectStatus.MEDIOS_EN_REVISION: (
        "Completa las escenas de list_pending (choose_media + download_and_approve) y luego "
        "cierra la etapa con approve_all_media."
    ),
    ProjectStatus.MEDIOS_APROBADOS: (
        "Genera la voz con generate_voice (Piper o ElevenLabs), o importa una grabación "
        "(import_voice) y transcríbela."
    ),
    ProjectStatus.VOZ_LISTA: (
        "Afina tramos con set_trim si hace falta y renderiza con render_video "
        "(o exporta el timeline con export_timeline)."
    ),
    ProjectStatus.TIMELINE_LISTO: "Renderiza con render_video.",
}

SAVE_SCENES_DOC = (
    "Guarda la tabla de escenas (guion aprobado). Cada escena: seg_key del guion, tipo "
    "(video | imagen | real | texto | negro), descripcion_visual, busqueda_en (obligatoria para "
    "video e imagen, en inglés), busqueda_alt, busqueda_real (obligatoria para real: nombres, "
    "lugares y fechas del caso), efecto, texto_pantalla, sfx y musica. Todos los segmentos deben "
    "tener al menos una escena. Los tiempos los calcula la app. mode=pending: solo los segmentos "
    f"sin escenas o con escenas para revisar. Efectos: {', '.join(EFFECTS)}."
)
GENERATE_VOICE_DOC = (
    "Genera la voz segmento por segmento y aplica los tiempos reales a las escenas. "
    "Sin engine usa el motor por defecto de Ajustes (el último usado). "
    "engine=piper (local y gratis; voice_id: por defecto la del canal o "
    f"{DEFAULT_VOICE}) o engine=elevenlabs (profesional, requiere su clave; voice_id de "
    "list_elevenlabs_voices, model_id, stability, similarity_boost, style; subtítulos exactos "
    "por palabra). El plan gratuito de ElevenLabs no permite uso comercial. Devuelve el job."
)

# Estilos rápidos de subtítulos (los mismos que en la app).
SUBTITLE_PRESETS: dict[str, dict[str, Any]] = {
    "reel": {
        "font": "Montserrat", "italic": True, "edge": "shadow", "animation": "pop",
        "uppercase": True, "highlight": True, "highlight_color": "#FFD400",
        "text_color": "#FFFFFF", "background": False,
    },
    "clasico": {
        "font": "Arial", "italic": False, "edge": "outline", "animation": "none",
        "uppercase": True, "highlight": True, "highlight_color": "#FFD400",
        "text_color": "#FFFFFF", "background": False,
    },
    "caja": {
        "font": "Arial", "italic": False, "edge": "outline", "animation": "none",
        "uppercase": False, "highlight": True, "highlight_color": "#FFD400",
        "text_color": "#FFFFFF", "background": True,
    },
}  # fmt: skip


def _session() -> Session:
    return Session(get_engine())


def _mcp_tool(fn: Callable) -> Callable:
    """Marca los cambios como hechos por MCP y convierte los errores de dominio en errores
    de herramienta con el mensaje en español (sin traza)."""

    @functools.wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        token = current_actor.set("mcp")
        try:
            result = fn(*args, **kwargs)
            if inspect.isawaitable(result):
                result = await result
            return result
        except DomainError as exc:
            raise ToolError(str(exc)) from exc
        finally:
            current_actor.reset(token)

    return wrapper


def _channel(session: Session, ref: str | int) -> Channel:
    """Canal por id, slug o nombre (sin distinguir mayúsculas)."""
    if isinstance(ref, int) or str(ref).isdigit():
        return channels.get_channel(session, int(ref))
    text = str(ref).strip().lower()
    for c in session.exec(select(Channel)).all():
        if text in (c.slug.lower(), c.name.lower()):
            return c
    raise NotFound(f"No existe el canal «{ref}»")


def _job_summary(job: JobRead) -> dict[str, Any]:
    return {
        "job_id": job.id,
        "type": job.type,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "result": job.result,
        "error": job.error,
    }


def _candidate(c: Any) -> dict[str, Any]:
    return {
        "candidate_id": c.id,
        "provider": c.provider,
        "kind": c.kind,
        "width": c.width,
        "height": c.height,
        "duration_s": c.duration_s,
        "author": c.author,
        "license": c.license,
        "page_url": c.page_url,
        "preview_url": c.preview_url,
        "download_status": c.download_status,
        "asset_id": c.asset.id if c.asset else None,
    }


def _scene_media(m: Any) -> dict[str, Any]:
    return {
        "scene_id": m.scene_id,
        "position": m.position,
        "status": m.status,
        "approved": [
            {"asset_id": a.asset.id, "role": a.role, "file_name": a.file_name} for a in m.approved
        ],
        "downloaded": [_candidate(c) for c in m.candidates if c.asset],
    }


class SegmentInput(BaseModel):
    seg_key: str | None = Field(
        default=None, description="Clave existente (seg_001…); vacío para un segmento nuevo"
    )
    section: str | None = Field(default=None, description="Sección: gancho, contexto, cierre…")
    text: str = Field(min_length=1, description="Texto que se narra")
    needs_fact_check: bool = Field(default=False, description="Dato que conviene verificar")


class IdeaItem(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    notes: str | None = None
    priority: int = Field(default=2, ge=1, le=3, description="1 alta · 2 media · 3 baja")


def build_mcp() -> MCPServer:
    server = MCPServer(name="guionaria", version=__version__, instructions=INSTRUCTIONS)

    def tool(fn: Callable | None = None, *, description: str | None = None) -> Callable:
        def register(f: Callable) -> Callable:
            server.tool(description=description)(_mcp_tool(f))
            return f

        return register(fn) if fn else register

    # --- canales y proyectos ---

    @tool
    def list_channels() -> dict[str, Any]:
        """Canales con su formato, plataformas, voz por defecto y cantidad de proyectos."""
        with _session() as s:
            return {"channels": [c.model_dump() for c in channels.list_channels(s)]}

    @tool
    def create_project(
        channel: str,
        title: str,
        format: Literal["video", "reel"],
        topic: str | None = None,
        notes: str | None = None,
        target_duration_s: int | None = None,
    ) -> dict[str, Any]:
        """Crea un proyecto. channel: id, slug o nombre del canal. format: video (16:9) o reel
        (9:16). notes: notas de investigación con los datos confirmados."""
        with _session() as s:
            ch = _channel(s, channel)
            p = projects.create_project(
                s,
                ProjectCreate(
                    channel_id=ch.id,
                    title=title,
                    format=format,
                    topic=topic,
                    research_notes=notes,
                    target_duration_s=target_duration_s,
                ),
            )
            return {"project_id": p.id, "folder": p.folder_path, "status": p.status}

    @tool
    def list_projects(
        channel: str | None = None, status: ProjectStatus | None = None, query: str | None = None
    ) -> dict[str, Any]:
        """Proyectos, del más reciente al más antiguo. Filtros opcionales: canal, estado y
        texto (busca en título, tema, notas y guion)."""
        with _session() as s:
            channel_id = _channel(s, channel).id if channel else None
            rows = projects.list_projects(s, channel_id, status, query)
            return {
                "projects": [
                    {
                        "project_id": p.id,
                        "title": p.title,
                        "channel": p.channel_name,
                        "format": p.format,
                        "status": p.status,
                        "updated_at": p.updated_at,
                    }
                    for p in rows
                ]
            }

    @tool
    def get_project(project_id: int) -> dict[str, Any]:
        """Proyecto con su estado, un resumen de cada etapa y el paso siguiente."""
        with _session() as s:
            p = projects.read_project(s, project_id)
            summary: dict[str, Any] = {"project": p.model_dump()}
            if script.current_version(s, project_id):
                sc = script.read_script(s, project_id)
                summary["script"] = {
                    "version": sc.version,
                    "status": sc.status,
                    "segments": len(sc.segments),
                    "words": sc.word_count,
                    "estimated_s": sc.total_est_s,
                }
            st = scene_svc.list_scenes(s, project_id)
            if st.scenes:
                summary["scenes"] = {
                    "count": len(st.scenes),
                    "to_review": st.review_count,
                    "approved": st.approved,
                    "total_s": st.total_s,
                }
                ov = media.media_overview(s, project_id)
                summary["media"] = {
                    "needing_media": ov.needing_media,
                    "with_media": ov.with_media,
                    "approved": ov.approved,
                    "providers": ov.configured_providers,
                }
            v = voice.voice_state(s, project_id)
            summary["voice"] = {
                "source": v.source,
                "duration_s": v.duration_s,
                "timing_source": v.timing_source,
                "stale": v.stale,
            }
            project = projects.get_project(s, project_id)
            summary["timeline_files"] = [e.file for e in timeline._exports(project)]
            summary["next_step"] = NEXT_STEP.get(
                project.status, "Listo para editar: abre el timeline en DaVinci Resolve."
            )
            return summary

    # --- ideas ---

    @tool
    def list_ideas(
        channel: str | None = None,
        status: Literal["open", "converted", "discarded"] | None = "open",
    ) -> dict[str, Any]:
        """Banco de ideas (por defecto, las abiertas), de mayor a menor prioridad."""
        with _session() as s:
            channel_id = _channel(s, channel).id if channel else None
            return {"ideas": [i.model_dump() for i in ideas.list_ideas(s, channel_id, status)]}

    @tool
    def add_ideas(channel: str, items: list[IdeaItem]) -> dict[str, Any]:
        """Guarda varias ideas en el banco del canal. Cada una: title, notes (opcional) y
        priority (1 alta, 2 media, 3 baja)."""
        with _session() as s:
            ch = _channel(s, channel)
            created = []
            for item in items:
                data = ideas.IdeaCreate(channel_id=ch.id, **item.model_dump())
                created.append(ideas.create_idea(s, data).id)
            return {"idea_ids": created}

    @tool
    def convert_idea(
        idea_id: int,
        format: Literal["video", "reel"],
        target_duration_s: int | None = None,
        target_publish_at: str | None = None,
    ) -> dict[str, Any]:
        """Convierte una idea en proyecto (título y notas pasan al proyecto)."""
        with _session() as s:
            p = ideas.convert_idea(
                s,
                idea_id,
                ideas.ConvertRequest(
                    format=format,
                    target_duration_s=target_duration_s,
                    target_publish_at=target_publish_at,
                ),
            )
            return {"project_id": p.id, "folder": p.folder_path, "status": p.status}

    @tool
    def research_idea(idea_id: int) -> dict[str, Any]:
        """Investiga la idea en internet (búsqueda web aislada, con tope de búsquedas) y guarda
        una ficha con fuentes: cada dato con su certeza y sus citas. Las notas de la idea quedan
        con la versión citada; las anteriores se conservan debajo. Devuelve el job."""
        from .services import research
        from .services.llm.claude_cli import get_runner

        with _session() as s:
            ideas.get_idea(s, idea_id)
        runner = get_runner()

        async def work(ctx: JobContext) -> dict:
            return await research.research_idea(_session, idea_id, runner, ctx)

        job = jobs.jobs.submit("research", work, payload={"idea_id": idea_id}, exclusive=False)
        return _job_summary(job)

    @tool
    def research_project(project_id: int) -> dict[str, Any]:
        """Investiga el tema del proyecto en internet y guarda la ficha con fuentes en sus notas
        de investigación y en investigacion.md. Hazlo antes de escribir el guion.
        Devuelve el job."""
        from .services import research
        from .services.llm.claude_cli import get_runner

        with _session() as s:
            projects.get_project(s, project_id)
        runner = get_runner()

        async def work(ctx: JobContext) -> dict:
            return await research.research_project(_session, project_id, runner, ctx)

        return _job_summary(jobs.jobs.submit("research", work, project_id=project_id))

    # --- guion ---

    @tool
    def save_script(project_id: int, segments: list[SegmentInput]) -> dict[str, Any]:
        """Guarda el guion completo como una versión nueva. Mantén el seg_key de los segmentos
        que ya existen (así sus escenas se conservan); deja seg_key vacío en los nuevos. Un
        segmento es una frase o idea de 1–3 oraciones."""
        with _session() as s:
            incoming = [SegmentIn(**seg.model_dump()) for seg in segments]
            sc = script.save_script(s, project_id, incoming, source="mcp")
            return sc.model_dump()

    @tool
    def get_script(project_id: int, version: int | None = None) -> dict[str, Any]:
        """Guion vigente (o una versión anterior) con sus segmentos y duraciones estimadas."""
        with _session() as s:
            return script.read_script(s, project_id, version).model_dump()

    @tool
    def update_segment(project_id: int, seg_key: str, text: str) -> dict[str, Any]:
        """Cambia el texto de un segmento (guion sin aprobar). Las escenas de ese segmento
        quedan para revisar."""
        with _session() as s:
            current = script.read_script(s, project_id)
            if seg_key not in {x.seg_key for x in current.segments}:
                raise NotFound(f"No existe el segmento {seg_key}")
            incoming = [
                SegmentIn(
                    seg_key=x.seg_key,
                    section=x.section,
                    text=text if x.seg_key == seg_key else x.text,
                    needs_fact_check=x.needs_fact_check,
                )
                for x in current.segments
            ]
            sc = script.save_script(s, project_id, incoming, source="mcp")
            affected = s.exec(
                select(Scene).where(Scene.project_id == project_id, Scene.seg_key == seg_key)
            ).all()
            return {
                "script_version": sc.version,
                "scenes_to_review": [x.id for x in affected if x.status == "review"],
            }

    @tool
    def approve_script(project_id: int) -> dict[str, Any]:
        """Aprueba el guion vigente: habilita las escenas y la voz."""
        with _session() as s:
            sc = script.approve_script(s, project_id)
            return {"ok": True, "version": sc.version}

    # --- escenas ---

    @tool(description=SAVE_SCENES_DOC)
    def save_scenes(
        project_id: int, scenes: list[EscenaClaude], mode: Literal["all", "pending"] = "all"
    ) -> dict[str, Any]:
        with _session() as s:
            st = scene_svc.save_scenes(s, project_id, scenes, mode)
            return {
                "count": len(st.scenes),
                "total_s": st.total_s,
                "scenes": [
                    {
                        "scene_id": x.id,
                        "position": x.position,
                        "seg_key": x.seg_key,
                        "media_kind": x.media_kind,
                        "start_s": x.start_s,
                        "end_s": x.end_s,
                    }
                    for x in st.scenes
                ],
            }

    @tool
    def update_scene(scene_id: int, fields: SceneUpdate) -> dict[str, Any]:
        """Edita campos de una escena (escenas sin aprobar): media_kind, visual_description,
        query_en, query_alt, query_real, effect, on_screen_text, sfx, music_cue."""
        with _session() as s:
            return scene_svc.update_scene(s, scene_id, fields).model_dump()

    @tool
    def approve_scenes(project_id: int) -> dict[str, Any]:
        """Aprueba la tabla de escenas: habilita la búsqueda de medios."""
        with _session() as s:
            st = scene_svc.approve_scenes(s, project_id)
            return {"ok": True, "scenes": len(st.scenes)}

    # --- medios ---

    @tool
    async def search_media(
        scene_id: int,
        query: str | None = None,
        provider: str | None = None,
        page: int = 1,
        any_orientation: bool = False,
    ) -> dict[str, Any]:
        """Busca medios para una escena con su búsqueda por defecto o la que indiques.
        provider: pexels, pixabay, unsplash, openverse, wikimedia o searxng (por defecto, los
        adecuados al tipo de escena). Devuelve candidatos para select_candidates."""
        from .schemas.media import SearchRequest

        with _session() as s:
            req = SearchRequest(
                query=query,
                providers=[provider] if provider else None,
                page=page,
                any_orientation=any_orientation,
            )
            result = await media.search_scene(s, scene_id, req)
            return {
                "warnings": result.warnings,
                "has_more": result.has_more,
                "candidates": [_candidate(c) for c in result.scene.candidates],
            }

    @tool
    def select_candidates(scene_id: int, candidate_ids: list[int]) -> dict[str, Any]:
        """Descarga los candidatos elegidos (en segundo plano). Devuelve el job."""
        with _session() as s:
            scene = media.get_scene(s, scene_id)

        async def work(ctx: JobContext) -> dict:
            return await media.download_candidates(_session, scene_id, candidate_ids, ctx)

        job = jobs.jobs.submit(
            "download_media",
            work,
            project_id=scene.project_id,
            payload={"scene_id": scene_id, "candidates": candidate_ids},
            exclusive=False,
        )
        return _job_summary(job)

    @tool
    def choose_media(scene_id: int, candidate_ids: list[int]) -> dict[str, Any]:
        """Marca candidatos como elegidos (en ese orden: el primero será el principal) sin
        descargarlos todavía. Después usa download_and_approve para bajar lo elegido de todas
        las escenas a la vez."""
        with _session() as s:
            result = None
            for cid in candidate_ids:
                result = media.select_candidate(s, scene_id, cid, True)
            return _scene_media(result or media.scene_media(s, scene_id))

    @tool
    def download_and_approve(project_id: int) -> dict[str, Any]:
        """Descarga lo elegido (choose_media) en todas las escenas y deja como principal el primero
        elegido de cada escena sin medio. El resultado incluye «trim»: videos más largos que su
        escena, candidatos a set_trim. Devuelve el job."""
        with _session() as s:
            if not media.media_overview(s, project_id).editable:
                raise DomainError("Los medios están aprobados: desbloquéalos para cambiarlos")

        async def work(ctx: JobContext) -> dict:
            return await media.download_selected(_session, project_id, ctx)

        return _job_summary(jobs.jobs.submit("download_selected", work, project_id=project_id))

    @tool
    def search_library(
        query: str | None = None,
        kind: Literal["image", "video"] | None = None,
        channel: str | None = None,
        orientation: Literal["landscape", "portrait", "square"] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Busca en la biblioteca global (medios ya descargados en cualquier proyecto) por nombre,
        autor u origen. Úsalo antes de buscar en internet: reuse_media no ocupa espacio extra."""
        with _session() as s:
            channel_id = _channel(s, channel).id if channel else None
            page = library.list_library(
                s, kind=kind, channel_id=channel_id, orientation=orientation, q=query,
                page_size=max(1, min(limit, 100)),
            )  # fmt: skip
            return {
                "total": page.total,
                "items": [
                    {
                        "asset_id": i.asset.id,
                        "file_name": i.asset.file_name,
                        "kind": i.asset.kind,
                        "provider": i.asset.provider,
                        "author": i.asset.author,
                        "license": i.asset.license,
                        "width": i.asset.width,
                        "height": i.asset.height,
                        "duration_s": i.asset.duration_s,
                        "project": i.project_title,
                        "used": bool(i.used_in),
                    }
                    for i in page.items
                ],
            }

    @tool
    def reuse_media(asset_id: int, scene_id: int) -> dict[str, Any]:
        """Usa un medio de la biblioteca en una escena (queda como candidato descargado; después
        apruébalo con approve_media)."""
        with _session() as s:
            return _scene_media(library.reuse_asset(s, asset_id, scene_id))

    @tool
    def approve_media(
        scene_id: int, asset_id: int, role: Literal["main", "alt"] = "main"
    ) -> dict[str, Any]:
        """Aprueba un medio descargado para la escena (main) o lo guarda como alterno (alt)."""
        with _session() as s:
            return _scene_media(media.approve_asset(s, scene_id, asset_id, role))

    @tool
    def set_framing(
        scene_id: int,
        asset_id: int,
        mode: Literal["none", "crop", "blur"] = "none",
        crop: framing.Crop | None = None,
        trim_in_s: float | None = None,
        trim_out_s: float | None = None,
    ) -> dict[str, Any]:
        """Encuadre del medio aprobado. mode: none (tal cual), crop (área visible en fracciones
        0–1 del original con la proporción del formato; sin crop se usa el recorte centrado) o
        blur (medio completo sobre fondo desenfocado). trim_in_s/trim_out_s: tramo de un video.
        Los videos con crop o blur se codifican en segundo plano (devuelve el job)."""
        with _session() as s:
            if mode == "crop" and crop is None:
                crop = framing.get_framing(s, scene_id, asset_id).suggested_crop
            data = framing.FramingIn(
                mode=mode, crop=crop, trim_in_s=trim_in_s, trim_out_s=trim_out_s
            )
            state, pending = framing.save_framing(s, scene_id, asset_id, data)
            scene = media.get_scene(s, scene_id)
        out: dict[str, Any] = {"framing": state.model_dump()}
        if pending:

            async def work(ctx: JobContext) -> dict:
                return await framing.render_framed_video(_session, scene_id, asset_id, ctx)

            job = jobs.jobs.submit(
                "frame_media",
                work,
                project_id=scene.project_id,
                payload={"scene_id": scene_id, "asset_id": asset_id},
                exclusive=False,
            )
            out["job"] = _job_summary(job)
        return out

    @tool
    def set_trim(
        scene_id: int, asset_id: int, trim_in_s: float | None, trim_out_s: float | None
    ) -> dict[str, Any]:
        """Tramo del video aprobado de una escena (el momento exacto que se usa), sin cambiar su
        encuadre. Funciona también con los medios ya aprobados. null en ambos = clip completo.
        Mira get_project (duración de cada escena) para elegir un tramo del mismo largo."""
        with _session() as s:
            current = framing.get_framing(s, scene_id, asset_id)
            data = framing.FramingIn(
                mode=current.mode, crop=current.crop, trim_in_s=trim_in_s, trim_out_s=trim_out_s
            )
            state, pending = framing.save_framing(s, scene_id, asset_id, data)
            scene = media.get_scene(s, scene_id)
        out: dict[str, Any] = {
            "trim_in_s": state.trim_in_s,
            "trim_out_s": state.trim_out_s,
            "source_duration_s": state.source_duration_s,
            "scene_duration_s": state.scene_duration_s,
        }
        if pending:

            async def work(ctx: JobContext) -> dict:
                return await framing.render_framed_video(_session, scene_id, asset_id, ctx)

            job = jobs.jobs.submit(
                "frame_media",
                work,
                project_id=scene.project_id,
                payload={"scene_id": scene_id, "asset_id": asset_id},
                exclusive=False,
            )
            out["job"] = _job_summary(job)
        return out

    @tool
    def approve_all_media(project_id: int) -> dict[str, Any]:
        """Cierra la etapa de medios: todas las escenas que lo necesitan tienen medio."""
        with _session() as s:
            ov = media.approve_media(s, project_id)
            return {"ok": True, "with_media": ov.with_media, "needing_media": ov.needing_media}

    @tool
    def list_pending(project_id: int) -> dict[str, Any]:
        """Escenas que necesitan medio y todavía no tienen uno aprobado."""
        with _session() as s:
            ov = media.media_overview(s, project_id)
            by_id = {
                x.id: x
                for x in s.exec(
                    select(Scene)
                    .where(Scene.project_id == project_id)
                    .order_by(col(Scene.position))
                )
            }
            return {
                "pending": [
                    {
                        "scene_id": x.scene_id,
                        "position": x.position,
                        "media_kind": x.media_kind,
                        "status": x.status,
                        "visual_description": by_id[x.scene_id].visual_description,
                        "query_en": by_id[x.scene_id].query_en,
                        "query_real": by_id[x.scene_id].query_real,
                    }
                    for x in ov.scenes
                    if x.needs_media and x.status not in ("approved", "manual")
                ]
            }

    @tool
    async def add_media_from_url(
        scene_id: int, url: str, start_s: float | None = None, end_s: float | None = None
    ) -> dict[str, Any]:
        """Agrega un medio desde una dirección: imagen o video directo, página web (se toma su
        imagen principal) o video de YouTube, noticias o redes (yt-dlp, en segundo plano; con
        start_s/end_s baja solo ese tramo)."""
        host = url.split("//", 1)[-1].split("/", 1)[0].lower().removeprefix("www.")
        is_video_site = any(host == d or host.endswith("." + d) for d in manual.VIDEO_SITES)
        with _session() as s:
            scene = media.get_scene(s, scene_id)
            if not is_video_site:
                return _scene_media(await manual.import_url(s, scene_id, url))
        video_url.validate(url, start_s, end_s)

        async def work(ctx: JobContext) -> dict:
            return await video_url.download_video_url(_session, scene_id, url, start_s, end_s, ctx)

        job = jobs.jobs.submit(
            "download_url",
            work,
            project_id=scene.project_id,
            payload={"scene_id": scene_id, "url": url},
            exclusive=False,
        )
        return _job_summary(job)

    # --- SFX y música ---

    @tool
    def search_sounds(
        query: str | None = None,
        kind: Literal["sfx", "music"] | None = None,
        tag: str | None = None,
    ) -> dict[str, Any]:
        """Busca en la biblioteca local de efectos de sonido y música (por título, etiquetas o
        mood). Para asignarlos a una escena usa assign_sound."""
        with _session() as s:
            found = sounds.list_sounds(s, kind, query, tag)
            return {
                "sounds": [
                    {
                        "sound_id": x.id,
                        "kind": x.kind,
                        "title": x.title,
                        "tags": x.tags,
                        "mood": x.mood,
                        "duration_s": x.duration_s,
                        "license": x.license,
                    }
                    for x in found[:50]
                ]
            }

    @tool
    def assign_sound(
        scene_id: int, role: Literal["sfx", "music"], sound_id: int | None
    ) -> dict[str, Any]:
        """Asigna a una escena un efecto (sfx, suena al inicio) o un tema de música (desde esa
        escena hasta el siguiente cambio). sound_id vacío lo quita."""
        with _session() as s:
            result = sounds.assign_sound(s, scene_id, role, sound_id)
            return {
                "scene_id": result.scene_id,
                "sfx": result.sfx.title if result.sfx else None,
                "music": result.music.title if result.music else None,
            }

    # --- voz ---

    @tool(description=GENERATE_VOICE_DOC)
    def generate_voice(
        project_id: int,
        engine: Literal["piper", "elevenlabs"] | None = None,
        voice_id: str | None = None,
        speed: Annotated[float, Field(ge=0.7, le=1.4)] = 1.0,
        pause_s: Annotated[float, Field(ge=0, le=2)] = voice.DEFAULT_PAUSE_S,
        model_id: str = elevenlabs.DEFAULT_MODEL,
        stability: Annotated[float, Field(ge=0, le=1)] = 0.5,
        similarity_boost: Annotated[float, Field(ge=0, le=1)] = 0.75,
        style: Annotated[float, Field(ge=0, le=1)] = 0.0,
    ) -> dict[str, Any]:
        with _session() as s:
            voice._require_ready(s, projects.get_project(s, project_id))
        engine = engine or voice.default_engine()
        eleven = None
        if engine == "elevenlabs":
            prefs = load_settings().elevenlabs
            chosen = voice_id or prefs.voice_id
            if not chosen:
                raise DomainError("Indica voice_id (usa list_elevenlabs_voices)")
            eleven = elevenlabs.ElevenSettings(
                voice_id=chosen,
                model_id=model_id,
                stability=stability,
                similarity_boost=similarity_boost,
                style=style,
                speed=min(max(speed, 0.7), 1.2),
            )

        async def work(ctx: JobContext) -> dict:
            return await voice.generate_voice(
                _session, project_id, voice_id, speed, pause_s, ctx, engine=engine, eleven=eleven
            )

        job = jobs.jobs.submit("voice", work, project_id=project_id, payload={"action": "generate"})
        return _job_summary(job)

    @tool
    async def list_elevenlabs_voices(query: str | None = None) -> dict[str, Any]:
        """Voces de la cuenta de ElevenLabs (propias, clonadas y de la biblioteca añadidas a «My
        Voices») y los créditos que quedan este mes. query filtra por nombre, acento, género…"""
        voices = await elevenlabs.list_voices()
        q = (query or "").lower()
        found = [
            v
            for v in voices
            if not q or q in " ".join([v.name, v.description or "", *v.labels.values()]).lower()
        ]
        try:
            account = (await elevenlabs.account()).model_dump()
        except DomainError:
            account = None
        return {
            "voices": [
                {"voice_id": v.voice_id, "name": v.name, "category": v.category, "labels": v.labels}
                for v in found
            ],
            "models": [m.model_dump() for m in elevenlabs.MODELS],
            "account": account,
        }

    @tool
    def import_voice(project_id: int, path: str) -> dict[str, Any]:
        """Importa una voz grabada desde un archivo local (WAV, MP3, M4A, AAC, OGG o FLAC).
        Después usa transcribe_voice para obtener los tiempos reales."""
        source = Path(path)
        if not source.is_file():
            raise NotFound(f"No existe el archivo {path}")
        with _session() as s, tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
            copy = Path(tmp) / source.name
            shutil.copy2(source, copy)  # el servicio mueve el archivo: se trabaja con una copia
            st = voice.upload_voice(s, project_id, copy, source.name)
            return {"source": st.source, "duration_s": st.duration_s}

    @tool
    def transcribe_voice(project_id: int) -> dict[str, Any]:
        """Transcribe la voz con Whisper (local), la alinea con el guion y aplica los tiempos
        reales a las escenas. Devuelve el job."""
        with _session() as s:
            voice._require_ready(s, projects.get_project(s, project_id))

        async def work(ctx: JobContext) -> dict:
            return await voice.transcribe_voice(_session, project_id, ctx)

        job = jobs.jobs.submit(
            "voice", work, project_id=project_id, payload={"action": "transcribe"}
        )
        return _job_summary(job)

    # --- salida ---

    @tool
    def export_timeline(
        project_id: int, format: Literal["otio", "fcpxml", "edl"] | None = None
    ) -> dict[str, Any]:
        """Exporta el timeline para DaVinci Resolve u otro editor (por defecto los tres formatos).
        Requiere los medios aprobados."""
        with _session() as s:
            r = timeline.export_timeline(s, project_id, [format] if format else None)
            return {
                "folder": r.folder,
                "files": [str(Path(r.folder) / f) for f in r.files],
                "warnings": r.warnings,
            }

    @tool
    def render_video(
        project_id: int,
        quality: Literal["draft", "standard", "high", "max"] | None = None,
        burn_subtitles: bool | None = None,
        subtitle_preset: Literal["reel", "clasico", "caja"] | None = None,
        subtitle_style: SubtitleStyle | None = None,
        text_style: TextStyle | None = None,
        draft: bool = False,
    ) -> dict[str, Any]:
        """Renderiza el video con FFmpeg (efectos, voz, SFX, música con ducking y subtítulos).
        quality: draft (720p rápido), standard (1080p), high (1080p nítido), max (4K reescalado,
        YouTube le da más bitrate). burn_subtitles: por defecto sí en reels. Estilo de subtítulos:
        subtitle_preset (reel = Montserrat cursiva con sombra y pop; clasico; caja) o
        subtitle_style completo; sin ninguno, el último usado. text_style: texto en pantalla de
        las escenas (font, size, uppercase, box, text_color y animation: none, fade, pop, slide o
        typewriter); sin él, el último usado. Cancelable con cancel_job."""
        from .services.render import service as render

        with _session() as s:
            projects.get_project(s, project_id)
        level = quality or ("draft" if draft else "standard")
        style = subtitle_style
        if subtitle_preset:
            base = (subtitle_style or load_settings().subtitle_style).model_dump()
            style = SubtitleStyle(**{**base, **SUBTITLE_PRESETS[subtitle_preset]})

        async def work(ctx: JobContext) -> dict:
            return await render.render_project(
                _session, project_id, level, burn_subtitles, ctx, style=style, text_style=text_style
            )

        job = jobs.jobs.submit(
            "render",
            work,
            project_id=project_id,
            payload={"quality": level, "draft": level == "draft"},
        )
        return _job_summary(job)

    @tool
    def cancel_job(job_id: int) -> dict[str, Any]:
        """Detiene un trabajo en curso (por ahora, el render). El render anterior se conserva."""
        return _job_summary(jobs.jobs.cancel(job_id))

    @tool
    def get_credits(project_id: int) -> str:
        """Créditos de los medios aprobados (autor, licencia y origen) para la descripción."""
        with _session() as s:
            project = projects.get_project(s, project_id)
            rows = s.exec(
                select(Scene).where(Scene.project_id == project_id).order_by(col(Scene.position))
            ).all()
            return credits_text(project.title, rows, _approved_by_scene(s, project_id))

    @tool
    def job_status(job_id: int) -> dict[str, Any]:
        """Estado y avance de un trabajo en segundo plano (descargas, voz, render…). status:
        queued, running, done, failed o cancelled."""
        return _job_summary(jobs.get_job(job_id))

    # --- recursos de solo lectura ---

    @server.resource("guionaria://project/{project_id}/script", mime_type="text/markdown")
    def script_resource(project_id: int) -> str:
        """Guion vigente en Markdown, un segmento por párrafo con su clave."""
        with _session() as s:
            sc = script.read_script(s, project_id)
            return "\n\n".join(
                f"**{x.seg_key}** ({x.section or '-'}, {x.est_duration_s:.1f} s): {x.text}"
                for x in sc.segments
            )

    @server.resource("guionaria://project/{project_id}/scenes", mime_type="text/markdown")
    def scenes_resource(project_id: int) -> str:
        """Tabla de escenas en Markdown con tiempos, tipo, búsquedas y efectos."""
        with _session() as s:
            project = projects.get_project(s, project_id)
            return scene_svc.to_markdown(project, scene_svc.list_scenes(s, project_id))

    @server.resource("guionaria://channel/{slug}/style", mime_type="text/markdown")
    def style_resource(slug: str) -> str:
        """Estilo del canal para redactar: tono, estructura del guion, idioma y velocidad."""
        with _session() as s:
            ch = _channel(s, slug)
            return "\n".join(
                [
                    f"# {ch.name}",
                    f"Idioma: {ch.language} · {ch.words_per_second} palabras/s",
                    "",
                    "## Estilo",
                    ch.style_prompt or "Claro y directo.",
                    "",
                    "## Estructura del guion",
                    ch.script_template or "Libre.",
                ]
            )

    return server


def transport_security() -> TransportSecuritySettings:
    """Solo localhost: protege contra DNS rebinding desde páginas abiertas en el navegador."""
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=["127.0.0.1:*", "localhost:*"],
        allowed_origins=["http://127.0.0.1:*", "http://localhost:*"],
    )
