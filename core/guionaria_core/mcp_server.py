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
from .db import get_engine
from .domain.states import ProjectStatus
from .models import Channel, Scene
from .schemas.project import ProjectCreate
from .schemas.scene import EFFECTS, EscenaClaude, SceneUpdate
from .schemas.script import SegmentIn
from .services import channels, jobs, projects, script
from .services import scenes as scene_svc
from .services.errors import DomainError, NotFound
from .services.jobs import JobContext, JobRead
from .services.media import manual, video_url
from .services.media import service as media
from .services.oplog import current_actor
from .services.package import _approved_by_scene, credits_text
from .services.timeline import service as timeline
from .services.voice import service as voice
from .services.voice.models import DEFAULT_VOICE

INSTRUCTIONS = """Guionaria convierte una idea en un video listo para editar, por etapas:
guion → escenas → medios → voz → timeline. Cada etapa se aprueba antes de pasar a la siguiente.
Tú redactas el guion y las escenas y los guardas con save_script y save_scenes: la app no vuelve
a llamar a Claude. Usa get_project para ver el estado y el paso siguiente. Las herramientas que
devuelven un trabajo (job) corren en segundo plano: consulta su avance con job_status.
Escribe el guion y las escenas en el idioma del canal (normalmente español)."""

NEXT_STEP = {
    ProjectStatus.IDEA: "Redacta el guion y guárdalo con save_script; luego approve_script.",
    ProjectStatus.GUION_BORRADOR: "Revisa el guion (get_script) y apruébalo con approve_script.",
    ProjectStatus.GUION_APROBADO: "Redacta las escenas y guárdalas con save_scenes.",
    ProjectStatus.ESCENAS_BORRADOR: "Revisa las escenas y apruébalas con approve_scenes.",
    ProjectStatus.ESCENAS_APROBADAS: (
        "Para cada escena de list_pending: search_media, select_candidates y approve_media."
    ),
    ProjectStatus.MEDIOS_EN_REVISION: (
        "Completa las escenas de list_pending y luego aprueba todo con approve_all_media."
    ),
    ProjectStatus.MEDIOS_APROBADOS: (
        "Genera la voz con generate_voice, o importa una grabación (import_voice) y transcríbela."
    ),
    ProjectStatus.VOZ_LISTA: "Exporta el timeline con export_timeline.",
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
    "Genera la voz con Piper (local y gratis) segmento por segmento y aplica los tiempos reales "
    f"a las escenas. voice_id: por defecto la del canal o {DEFAULT_VOICE}. Devuelve el job."
)


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
    def approve_media(
        scene_id: int, asset_id: int, role: Literal["main", "alt"] = "main"
    ) -> dict[str, Any]:
        """Aprueba un medio descargado para la escena (main) o lo guarda como alterno (alt)."""
        with _session() as s:
            return _scene_media(media.approve_asset(s, scene_id, asset_id, role))

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

    # --- voz ---

    @tool(description=GENERATE_VOICE_DOC)
    def generate_voice(
        project_id: int,
        engine: Literal["piper"] = "piper",
        voice_id: str | None = None,
        speed: Annotated[float, Field(ge=0.7, le=1.4)] = 1.0,
        pause_s: Annotated[float, Field(ge=0, le=2)] = voice.DEFAULT_PAUSE_S,
    ) -> dict[str, Any]:
        with _session() as s:
            voice._require_ready(s, projects.get_project(s, project_id))

        async def work(ctx: JobContext) -> dict:
            return await voice.generate_voice(_session, project_id, voice_id, speed, pause_s, ctx)

        job = jobs.jobs.submit("voice", work, project_id=project_id, payload={"action": "generate"})
        return _job_summary(job)

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
        """Estado y avance de un trabajo en segundo plano (descargas, voz, transcripción)."""
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
