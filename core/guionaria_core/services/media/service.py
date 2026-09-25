"""Búsqueda, descarga y revisión de medios por escena (secciones 5.5, 5.6 y 5.8 de SPEC.md)."""

import asyncio
import contextlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from sqlmodel import Session, col, delete, select

from ...config import get_paths, load_settings
from ...domain.states import ORDER, ProjectStatus
from ...models import Asset, Project, Scene, SceneAsset, SceneCandidate, SearchCache
from ...models._base import now_iso
from ...schemas.media import (
    ApprovedRead,
    AssetRead,
    CandidateRead,
    MediaOverview,
    SceneMediaRead,
    SceneMediaSummary,
    SearchRequest,
    SearchResult,
    SuggestResult,
)
from ...util.paths import check_path_length
from .. import prompts
from ..channels import get_channel
from ..errors import Conflict, DomainError, NotFound
from ..jobs import JobContext
from ..llm.claude_cli import ClaudeRunner, generate_structured
from ..oplog import log_operation
from ..projects import get_project, project_dir
from . import dedup, naming, process
from .http import http_client
from .providers import DEFAULTS, PROVIDERS, Candidate, Orientation, ProviderError

PER_PAGE = 15
CACHE_TTL = timedelta(hours=24)  # Pixabay pide cachear 24 h
RETRY_DELAYS = (0.5, 1.0, 2.0)
MEDIA_KINDS = ("video", "image", "real")  # texto y negro se generan en el render

# Etapa de medios: se busca y descarga desde que las escenas están aprobadas.
OPEN = (ProjectStatus.ESCENAS_APROBADAS, ProjectStatus.MEDIOS_EN_REVISION)

_download_slots: tuple[asyncio.AbstractEventLoop, int, asyncio.Semaphore] | None = None


def _slots() -> asyncio.Semaphore:
    """Límite global de descargas simultáneas (Ajustes → descargas en paralelo).

    Un Semaphore queda atado al event loop donde se usa por primera vez: se recrea si cambia
    el loop (otro proceso de servidor, tests) o el límite configurado."""
    global _download_slots
    loop = asyncio.get_running_loop()
    size = load_settings().download_parallelism
    if _download_slots is None or _download_slots[0] is not loop or _download_slots[1] != size:
        _download_slots = (loop, size, asyncio.Semaphore(size))
    return _download_slots[2]


# --- utilidades ---


def orientation_for(project: Project) -> Orientation:
    return "landscape" if project.format == "video" else "portrait"


def needs_media(scene: Scene) -> bool:
    return scene.media_kind in MEDIA_KINDS


def search_kind(scene: Scene) -> str | None:
    if scene.media_kind == "video":
        return "video"
    return "image" if scene.media_kind in ("image", "real") else None


def default_query(scene: Scene) -> str | None:
    if scene.media_kind == "real":
        return scene.query_real or scene.query_en or scene.query_alt
    return scene.query_en or scene.query_alt


def _abs(rel: str) -> Path:
    return get_paths().home / rel


def _rel(path: Path) -> str:
    return path.relative_to(get_paths().home).as_posix()


def configured_providers(kind: str | None = None) -> list[str]:
    """Fuentes utilizables: las que no piden clave y las que tienen su clave en Ajustes."""
    settings = load_settings()
    out = []
    for name, cls in PROVIDERS.items():
        if kind and kind not in cls.kinds:
            continue
        if cls.needs_key and not getattr(settings.api_keys, name, ""):
            continue
        if name == "searxng" and not settings.searxng_url:
            continue
        out.append(name)
    return out


def make_provider(name: str):
    settings = load_settings()
    if name == "searxng":
        return PROVIDERS[name](settings.searxng_url)
    return PROVIDERS[name](getattr(settings.api_keys, name, ""))


def default_providers(scene: Scene) -> list[str]:
    kind = search_kind(scene)
    available = configured_providers(kind) if kind else []
    return [p for p in DEFAULTS.get(scene.media_kind, []) if p in available]


def get_scene(session: Session, scene_id: int) -> Scene:
    scene = session.get(Scene, scene_id)
    if not scene:
        raise NotFound("La escena no existe")
    return scene


def _open_project(session: Session, project_id: int) -> Project:
    project = get_project(session, project_id)
    if project.status not in OPEN:
        if ORDER.index(project.status) < ORDER.index(ProjectStatus.ESCENAS_APROBADAS):
            raise Conflict("Aprueba las escenas antes de buscar medios")
        raise Conflict("Los medios están aprobados: desbloquéalos para cambiarlos")
    return project


def _enter_media_stage(project: Project) -> None:
    if project.status == ProjectStatus.ESCENAS_APROBADAS:
        project.status = ProjectStatus.MEDIOS_EN_REVISION
        project.updated_at = now_iso()


# --- lectura ---


def asset_read(asset: Asset) -> AssetRead:
    return AssetRead(
        id=asset.id,
        kind=asset.kind,
        file_name=Path(asset.file_path).name,
        file_url=f"/api/assets/{asset.id}/file",
        thumb_url=f"/api/assets/{asset.id}/thumb" if asset.thumb_path else None,
        provider=asset.provider,
        provider_id=asset.provider_id,
        source_page_url=asset.source_page_url,
        author=asset.author,
        license=asset.license,
        width=asset.width,
        height=asset.height,
        duration_s=asset.duration_s,
        orientation=asset.orientation,
        size_bytes=asset.size_bytes,
        low_res=bool(asset.low_res),
    )


def _candidate_read(session: Session, c: SceneCandidate) -> CandidateRead:
    asset = session.get(Asset, c.asset_id) if c.asset_id else None
    return CandidateRead(
        id=c.id,
        scene_id=c.scene_id,
        provider=c.provider,
        provider_id=c.provider_id,
        kind=c.kind,
        preview_url=c.preview_url,
        video_preview_url=c.video_preview_url,
        full_url=c.full_url,
        page_url=c.page_url,
        width=c.width,
        height=c.height,
        duration_s=c.duration_s,
        author=c.author,
        license=c.license,
        query=c.query,
        selected=bool(c.selected),
        download_status=c.download_status,
        error=c.error,
        asset=asset_read(asset) if asset else None,
    )


def _candidates(session: Session, scene_id: int) -> list[SceneCandidate]:
    return list(
        session.exec(
            select(SceneCandidate)
            .where(SceneCandidate.scene_id == scene_id)
            .order_by(col(SceneCandidate.id))
        ).all()
    )


def _approved(session: Session, scene_id: int) -> list[SceneAsset]:
    rows = session.exec(select(SceneAsset).where(SceneAsset.scene_id == scene_id)).all()
    return sorted(rows, key=lambda r: (r.role != "main", r.file_path or ""))


def scene_media(session: Session, scene_id: int) -> SceneMediaRead:
    scene = get_scene(session, scene_id)
    approved = []
    for row in _approved(session, scene_id):
        asset = session.get(Asset, row.asset_id)
        if asset:
            info = json.loads(row.crop_json) if row.crop_json else {}
            approved.append(
                ApprovedRead(
                    asset=asset_read(asset),
                    role=row.role,
                    file_name=Path(row.file_path or asset.file_path).name,
                    framing_mode=info.get("mode", "none"),
                    framing_pending=bool(info.get("pending")) and not info.get("rendered"),
                    trim_in_s=row.trim_in_s,
                    trim_out_s=row.trim_out_s,
                    approved_url=f"/api/scenes/{scene_id}/assets/{row.asset_id}/approved-file",
                )
            )
    return SceneMediaRead(
        scene_id=scene.id,
        position=scene.position,
        seg_key=scene.seg_key,
        media_kind=scene.media_kind,
        narration=scene.narration,
        visual_description=scene.visual_description,
        query_en=scene.query_en,
        query_alt=scene.query_alt,
        query_real=scene.query_real,
        start_s=scene.start_s,
        end_s=scene.end_s,
        status=scene.status,
        needs_media=needs_media(scene),
        default_query=default_query(scene),
        search_kind=search_kind(scene),
        available_providers=configured_providers(search_kind(scene)) if search_kind(scene) else [],
        default_providers=default_providers(scene),
        approved=approved,
        candidates=[_candidate_read(session, c) for c in _candidates(session, scene_id)],
    )


def media_overview(session: Session, project_id: int) -> MediaOverview:
    project = get_project(session, project_id)
    scenes = session.exec(
        select(Scene).where(Scene.project_id == project_id).order_by(col(Scene.position))
    ).all()
    summaries = []
    for scene in scenes:
        candidates = _candidates(session, scene.id)
        thumb = None
        if scene.approved_asset_id:
            asset = session.get(Asset, scene.approved_asset_id)
            thumb = asset_read(asset).thumb_url if asset else None
        summaries.append(
            SceneMediaSummary(
                scene_id=scene.id,
                position=scene.position,
                media_kind=scene.media_kind,
                visual_description=scene.visual_description,
                status=scene.status,
                needs_media=needs_media(scene),
                candidate_count=len(candidates),
                downloaded_count=sum(1 for c in candidates if c.download_status == "done"),
                approved_thumb_url=thumb,
            )
        )
    needing = [s for s in summaries if s.needs_media]
    return MediaOverview(
        project_id=project_id,
        orientation=orientation_for(project),
        editable=project.status in OPEN,
        approved=ORDER.index(project.status) >= ORDER.index(ProjectStatus.MEDIOS_APROBADOS),
        configured_providers=configured_providers(),
        scenes=summaries,
        needing_media=len(needing),
        with_media=sum(1 for s in needing if s.status in ("approved", "manual")),
    )


# --- búsqueda ---


def _cache_key(provider: str, kind: str, orientation: str | None, page: int, query: str) -> str:
    return f"{provider}:{kind}:{orientation or 'any'}:{page}:{query.strip().lower()}"


def _cache_get(session: Session, key: str) -> list[Candidate] | None:
    row = session.get(SearchCache, key)
    if not row or not row.response:
        return None
    created = datetime.fromisoformat(row.created_at)
    if datetime.now(UTC) - created > CACHE_TTL:
        return None
    return [Candidate(**c) for c in json.loads(row.response)]


def _cache_put(session: Session, key: str, candidates: list[Candidate]) -> None:
    row = session.get(SearchCache, key) or SearchCache(key=key)
    row.response = json.dumps([c.to_dict() for c in candidates], ensure_ascii=False)
    row.created_at = now_iso()
    session.add(row)


def _interleave(groups: list[list[Candidate]]) -> list[Candidate]:
    """Uno de cada banco por turno, para que la cuadrícula no quede agrupada por proveedor."""
    out: list[Candidate] = []
    for i in range(max((len(g) for g in groups), default=0)):
        out += [g[i] for g in groups if i < len(g)]
    return out


async def search_scene(session: Session, scene_id: int, req: SearchRequest) -> SearchResult:
    scene = get_scene(session, scene_id)
    project = _open_project(session, scene.project_id)
    kind = search_kind(scene)
    if not kind:
        raise DomainError(
            "Las escenas de texto o negro no necesitan medio: se generan en el render"
        )
    query = (req.query or default_query(scene) or "").strip()
    if not query:
        raise DomainError("Escribe qué buscar: la escena no tiene búsqueda definida")

    available = configured_providers(kind)
    wanted = [p for p in (req.providers or DEFAULTS.get(scene.media_kind, [])) if p in PROVIDERS]
    wanted = [p for p in wanted if kind in PROVIDERS[p].kinds]  # p. ej. Unsplash no tiene video
    active = [p for p in wanted if p in available]
    warnings = [
        f"{PROVIDERS[p].label}: falta la clave de API (Ajustes → Claves de API)"
        for p in wanted
        if p not in available
    ]
    if not active:
        raise DomainError(
            "No hay fuentes disponibles para esta escena: configura las claves en "
            "Ajustes → Claves de API"
        )

    orientation = None if req.any_orientation else orientation_for(project)
    results: dict[str, list[Candidate]] = {}
    to_fetch = []
    for name in active:
        cached = _cache_get(session, _cache_key(name, kind, orientation, req.page, query))
        if cached is not None:
            results[name] = cached
        else:
            to_fetch.append(name)

    if to_fetch:
        async with http_client() as client:
            fetched = await asyncio.gather(
                *(
                    make_provider(name).search(client, query, kind, orientation, req.page, PER_PAGE)
                    for name in to_fetch
                ),
                return_exceptions=True,
            )
        for name, outcome in zip(to_fetch, fetched, strict=True):
            if isinstance(outcome, ProviderError):
                warnings.append(outcome.message)
            elif isinstance(outcome, httpx.HTTPError):
                warnings.append(f"{PROVIDERS[name].label}: sin conexión ({type(outcome).__name__})")
            elif isinstance(outcome, BaseException):
                raise outcome
            else:
                results[name] = outcome
                _cache_put(session, _cache_key(name, kind, orientation, req.page, query), outcome)

    if req.page == 1:
        # Nueva búsqueda: se descartan los candidatos que no se eligieron ni descargaron.
        for c in _candidates(session, scene_id):
            if not c.selected and c.download_status == "none":
                session.delete(c)
        session.flush()

    existing = {(c.provider, c.provider_id) for c in _candidates(session, scene_id)}
    longest = max((len(v) for v in results.values()), default=0)
    seen: set[tuple[str, str]] = set()
    for c in _interleave(list(results.values())):
        key = (c.provider, c.provider_id)
        if key in existing or key in seen:
            continue
        seen.add(key)
        session.add(
            SceneCandidate(
                scene_id=scene_id,
                provider=c.provider,
                provider_id=c.provider_id,
                kind=c.kind,
                preview_url=c.preview_url,
                video_preview_url=c.video_preview_url,
                tracking_url=c.tracking_url,
                full_url=c.full_url,
                page_url=c.page_url,
                width=c.width,
                height=c.height,
                duration_s=c.duration_s,
                license=c.license,
                author=c.author,
                query=query,
            )
        )

    if scene.status == "pending":
        scene.status = "candidates"
    _enter_media_stage(project)
    session.commit()
    return SearchResult(
        scene=scene_media(session, scene_id),
        warnings=warnings,
        page=req.page,
        has_more=longest >= PER_PAGE,
    )


async def suggest_queries(session: Session, scene_id: int, runner: ClaudeRunner) -> SuggestResult:
    """Tres búsquedas alternativas en inglés para bancos de stock (sección 5.5)."""
    from pydantic import BaseModel, Field

    class Sugerencias(BaseModel):
        busquedas: list[str] = Field(min_length=3, max_length=3)

    scene = get_scene(session, scene_id)
    project = get_project(session, scene.project_id)
    channel = get_channel(session, project.channel_id)
    prompt = prompts.render(
        prompts.load_prompt("busquedas_alternativas"),
        canal=channel.name,
        narracion=scene.narration or "",
        descripcion=scene.visual_description or "",
        busqueda_actual=default_query(scene) or "",
        tipo="video" if scene.media_kind == "video" else "imagen",
        orientacion="horizontal" if project.format == "video" else "vertical",
    )
    result = await generate_structured(runner, prompt, Sugerencias, cwd=project_dir(project))
    return SuggestResult(queries=[q.strip() for q in result.busquedas if q.strip()])


# --- descarga ---


class DownloadError(Exception):
    pass


async def fetch_to(client: httpx.AsyncClient, url: str, dest: Path) -> tuple[int, str | None]:
    """Descarga con reintentos y backoff para errores de red o del servidor (5xx)."""
    last = "error desconocido"
    for attempt, delay in enumerate((*RETRY_DELAYS, None)):
        try:
            async with client.stream("GET", url) as resp:
                if resp.status_code >= 400:
                    last = f"HTTP {resp.status_code}"
                    if resp.status_code < 500:
                        raise DownloadError(last)  # 4xx: reintentar no sirve
                else:
                    tmp = dest.with_name(dest.name + ".part")
                    size = 0
                    with tmp.open("wb") as fh:
                        async for chunk in resp.aiter_bytes(64 * 1024):
                            fh.write(chunk)
                            size += len(chunk)
                    if size == 0:
                        tmp.unlink(missing_ok=True)
                        last = "archivo vacío"
                    else:
                        tmp.replace(dest)
                        return size, resp.headers.get("content-type")
        except httpx.TransportError as exc:
            last = f"sin conexión ({type(exc).__name__})"
        if delay is None or attempt >= len(RETRY_DELAYS):
            break
        await asyncio.sleep(delay)
    raise DownloadError(last)


@dataclass
class ProcessedFile:
    path: Path
    kind: str
    info: process.MediaInfo
    thumb: Path | None
    frame_hash: str | None
    sha256: str | None = None


async def process_file(dest: Path, kind: str) -> ProcessedFile:
    """Medidas, duración, miniatura y hash de un archivo ya guardado en el proyecto."""
    info = await asyncio.to_thread(
        process.image_info if kind == "image" else process.video_info, dest
    )
    thumb = dest.parent / ".thumbs" / f"{dest.stem}.jpg"
    frame_hash = await asyncio.to_thread(process.make_thumbnail, dest, thumb, kind, info.duration_s)
    sha256 = await asyncio.to_thread(dedup.file_sha256, dest)
    return ProcessedFile(dest, kind, info, thumb if thumb.exists() else None, frame_hash, sha256)


def create_asset(
    session: Session,
    f: ProcessedFile,
    *,
    provider: str,
    provider_id: str | None,
    page_url: str | None,
    file_url: str | None,
    author: str | None,
    license: str | None,
    low_res: bool = False,
    fallback: tuple[int | None, int | None, float | None] = (None, None, None),
) -> Asset:
    width = f.info.width or fallback[0]
    height = f.info.height or fallback[1]
    asset = Asset(
        kind=f.kind,
        file_path=_rel(f.path),
        thumb_path=_rel(f.thumb) if f.thumb else None,
        provider=provider,
        provider_id=provider_id,
        source_page_url=page_url,
        source_file_url=file_url,
        author=author,
        license=license,
        width=width,
        height=height,
        duration_s=f.info.duration_s or fallback[2],
        orientation=process.orientation(width, height),
        size_bytes=f.path.stat().st_size,
        phash=f.info.phash or f.frame_hash,
        low_res=int(low_res),
        sha256=f.sha256,
    )
    if f.sha256:
        dedup.dedupe(session, f.path, f.sha256)  # mismo contenido ya en la biblioteca: hardlink
    session.add(asset)
    session.flush()
    return asset


async def _notify_download(client: httpx.AsyncClient, snapshot: dict) -> None:
    """Unsplash pide avisar cada descarga en su download_location. No bloquea si falla."""
    if not snapshot.get("tracking_url") or snapshot["provider"] != "unsplash":
        return
    with contextlib.suppress(httpx.HTTPError):
        await client.get(snapshot["tracking_url"], headers=make_provider("unsplash").auth())


def _update_candidate(session_factory, candidate_id: int, **fields) -> None:
    with session_factory() as session:
        c = session.get(SceneCandidate, candidate_id)
        if c:
            for k, v in fields.items():
                setattr(c, k, v)
            session.commit()


async def _download_one(session_factory, candidate_id: int, client: httpx.AsyncClient) -> bool:
    with session_factory() as session:
        c = session.get(SceneCandidate, candidate_id)
        scene = session.get(Scene, c.scene_id)
        project = get_project(session, scene.project_id)
        folder = project_dir(project) / "media" / "candidates"
        snapshot = dict(
            tracking_url=c.tracking_url,
            provider=c.provider,
            provider_id=c.provider_id or str(c.id),
            kind=c.kind,
            full_url=c.full_url,
            preview_url=c.preview_url,
            page_url=c.page_url,
            author=c.author,
            license=c.license,
        )
        base_name = naming.candidate_name(scene, snapshot["provider"], snapshot["provider_id"], "")

    async with _slots():
        _update_candidate(session_factory, candidate_id, download_status="downloading", error=None)
        low_res = False
        try:
            ext = process.extension_for(snapshot["full_url"] or "", None, snapshot["kind"])
            dest = folder / f"{base_name}{ext}"
            try:
                check_path_length(dest)
            except DomainError as exc:
                raise DownloadError(exc.message) from exc
            try:
                size, _ = await fetch_to(client, snapshot["full_url"], dest)
            except DownloadError as first:
                # Si falla el original, se intenta la miniatura grande (solo imágenes).
                if snapshot["kind"] != "image" or not snapshot["preview_url"]:
                    raise
                ext = process.extension_for(snapshot["preview_url"], None, "image")
                dest = folder / f"{base_name}_baja{ext}"
                try:
                    size, _ = await fetch_to(client, snapshot["preview_url"], dest)
                except DownloadError:
                    raise first from None
                low_res = True
        except DownloadError as exc:
            _update_candidate(
                session_factory,
                candidate_id,
                download_status="failed",
                error=f"No se pudo descargar: {exc}. Ábrelo en el navegador y arrastra el archivo.",
            )
            return False

        processed = await process_file(dest, snapshot["kind"])
        await _notify_download(client, snapshot)

    with session_factory() as session:
        c = session.get(SceneCandidate, candidate_id)
        asset = create_asset(
            session,
            processed,
            provider=snapshot["provider"],
            provider_id=snapshot["provider_id"],
            page_url=snapshot["page_url"],
            file_url=snapshot["full_url"],
            author=snapshot["author"],
            license=snapshot["license"],
            low_res=low_res,
            fallback=(c.width, c.height, c.duration_s),
        )
        c.asset_id = asset.id
        c.download_status = "done"
        c.error = None
        session.commit()
    return True


async def download_candidates(
    session_factory, scene_id: int, candidate_ids: list[int], ctx: JobContext
) -> dict:
    with session_factory() as session:
        scene = get_scene(session, scene_id)
        project = _open_project(session, scene.project_id)
        candidates = [session.get(SceneCandidate, cid) for cid in candidate_ids]
        if any(c is None or c.scene_id != scene_id for c in candidates):
            raise DomainError("Algún candidato no pertenece a la escena")
        pending = [c.id for c in candidates if c.download_status != "done"]
        for c in candidates:
            c.selected = 1
            if c.download_status != "done":
                c.download_status = "queued"
        _enter_media_stage(project)
        session.commit()

    total = len(pending)
    done = 0
    ok = 0
    ctx.progress(0.02, f"Descargando {total} medios…")

    async with http_client() as client:

        async def one(cid: int) -> None:
            nonlocal done, ok
            # Esperar primero: `ok += await …` leería `ok` antes del await y las descargas
            # en paralelo se pisarían el contador.
            succeeded = await _download_one(session_factory, cid, client)
            ok += succeeded
            done += 1
            ctx.progress(done / max(total, 1), f"Descargados {done} de {total}")

        await asyncio.gather(*(one(cid) for cid in pending))

    with session_factory() as session:
        scene = get_scene(session, scene_id)
        if scene.status == "pending":
            scene.status = "candidates"
        log_operation(
            session,
            "download",
            "scene",
            scene_id,
            {"requested": total, "ok": ok},
            actor="system",
        )
        session.commit()
    return {"requested": total, "downloaded": ok, "failed": total - ok}


# --- aprobación de medios por escena ---


def _scene_assets_for(session: Session, scene: Scene) -> set[int]:
    """Medios que se pueden aprobar para la escena: los descargados de sus candidatos."""
    return {c.asset_id for c in _candidates(session, scene.id) if c.asset_id}


def approve_asset(session: Session, scene_id: int, asset_id: int, role: str) -> SceneMediaRead:
    scene = get_scene(session, scene_id)
    project = _open_project(session, scene.project_id)
    if asset_id not in _scene_assets_for(session, scene):
        raise DomainError("Ese medio no es un candidato descargado de esta escena")
    asset = session.get(Asset, asset_id)
    source = _abs(asset.file_path)
    if not source.exists():
        raise Conflict("El archivo descargado ya no está en la carpeta del proyecto")

    rows = _approved(session, scene_id)
    existing = next((r for r in rows if r.asset_id == asset_id), None)
    if existing and existing.role == role:
        return scene_media(session, scene_id)

    if role == "main":
        for r in rows:
            if r.role == "main" and r.asset_id != asset_id:
                _remove_approved(session, r)
    if existing:
        _remove_approved(session, existing)

    approved_dir = project_dir(project) / "media" / "approved"
    approved_dir.mkdir(parents=True, exist_ok=True)
    row = SceneAsset(scene_id=scene_id, asset_id=asset_id, role=role)
    session.add(row)
    session.flush()
    target = approved_dir / _expected_name(session, scene, row, source.suffix)
    check_path_length(target)
    dedup.link_or_copy(source, target)  # la copia aprobada no ocupa espacio de nuevo
    row.file_path = _rel(target)

    if role == "main":
        scene.approved_asset_id = asset_id
        scene.status = "approved"
    _enter_media_stage(project)
    log_operation(session, "approve", "asset", asset_id, {"scene": scene_id, "role": role})
    session.commit()
    return scene_media(session, scene_id)


def _remove_approved(session: Session, row: SceneAsset) -> None:
    if row.file_path:
        _abs(row.file_path).unlink(missing_ok=True)
    session.delete(row)
    session.flush()


def unapprove_asset(session: Session, scene_id: int, asset_id: int) -> SceneMediaRead:
    scene = get_scene(session, scene_id)
    _open_project(session, scene.project_id)
    row = next((r for r in _approved(session, scene_id) if r.asset_id == asset_id), None)
    if not row:
        raise NotFound("Ese medio no está aprobado en la escena")
    was_main = row.role == "main"
    _remove_approved(session, row)
    if was_main:
        scene.approved_asset_id = None
        scene.status = "candidates"
    sync_approved_names(session, scene.project_id)
    session.commit()
    return scene_media(session, scene_id)


def _expected_name(session: Session, scene: Scene, row: SceneAsset, ext: str) -> str:
    if row.role == "main":
        return naming.approved_name(scene, ext)
    alts = [r for r in _approved(session, scene.id) if r.role == "alt"]
    alts.sort(key=lambda r: r.asset_id)
    index = next(i for i, r in enumerate(alts, start=1) if r.asset_id == row.asset_id)
    return naming.approved_name(scene, ext, alt_index=index)


def sync_approved_names(session: Session, project_id: int) -> int:
    """Renombra los aprobados según la convención cuando cambian orden o tiempos (sección 9).
    En dos pasos (a temporales y luego al nombre final) para evitar choques."""
    scenes = session.exec(select(Scene).where(Scene.project_id == project_id)).all()
    moves: list[tuple[SceneAsset, Path, Path]] = []
    for scene in scenes:
        for row in _approved(session, scene.id):
            if not row.file_path:
                continue
            current = _abs(row.file_path)
            wanted = current.with_name(_expected_name(session, scene, row, current.suffix))
            if current != wanted:
                moves.append((row, current, wanted))
    if not moves:
        return 0
    temps = []
    for i, (_row, current, _wanted) in enumerate(moves):
        tmp = current.with_name(f".renombrando-{i}{current.suffix}")
        if current.exists():
            current.rename(tmp)
        temps.append(tmp)
    for (row, _current, wanted), tmp in zip(moves, temps, strict=True):
        if tmp.exists():
            tmp.rename(wanted)
        row.file_path = _rel(wanted)
    log_operation(session, "rename", "project", project_id, {"files": len(moves)}, actor="system")
    return len(moves)


# --- aprobación de la etapa ---


def approve_media(session: Session, project_id: int) -> MediaOverview:
    project = get_project(session, project_id)
    if project.status != ProjectStatus.MEDIOS_EN_REVISION:
        raise Conflict(
            "Los medios ya están aprobados"
            if ORDER.index(project.status) > ORDER.index(ProjectStatus.MEDIOS_EN_REVISION)
            else "Primero busca y aprueba medios para las escenas"
        )
    overview = media_overview(session, project_id)
    missing = [
        s.position
        for s in overview.scenes
        if s.needs_media and s.status not in ("approved", "manual")
    ]
    if missing:
        raise Conflict(f"Faltan medios en las escenas {', '.join(map(str, missing))}")
    from ..voice.service import real_segment_timings  # import local: voice depende de media

    # Si la voz ya estaba lista (tiempos reales vigentes), el proyecto pasa directo a VOZ_LISTA.
    project.status = (
        ProjectStatus.VOZ_LISTA
        if real_segment_timings(session, project_id)
        else ProjectStatus.MEDIOS_APROBADOS
    )
    project.updated_at = now_iso()
    log_operation(session, "approve", "media", project_id, {"scenes": overview.with_media})
    session.commit()
    return media_overview(session, project_id)


def unlock_media(session: Session, project_id: int) -> MediaOverview:
    project = get_project(session, project_id)
    if ORDER.index(project.status) < ORDER.index(ProjectStatus.MEDIOS_APROBADOS):
        raise Conflict("Los medios no están aprobados")
    project.status = ProjectStatus.MEDIOS_EN_REVISION
    project.updated_at = now_iso()
    log_operation(session, "unlock", "media", project_id)
    session.commit()
    return media_overview(session, project_id)


# --- limpieza ---


def delete_for_scenes(session: Session, scene_ids: list[int]) -> None:
    """Antes de borrar escenas: quita sus aprobados (y copias) y sus candidatos."""
    if not scene_ids:
        return
    rows = session.exec(select(SceneAsset).where(col(SceneAsset.scene_id).in_(scene_ids))).all()
    for row in rows:
        _remove_approved(session, row)
    session.exec(delete(SceneCandidate).where(col(SceneCandidate.scene_id).in_(scene_ids)))
    session.flush()


def delete_media_data(session: Session, project: Project) -> None:
    """Al eliminar el proyecto: filas de medios; los archivos se van con la carpeta a trash/."""
    scene_ids = [s.id for s in session.exec(select(Scene).where(Scene.project_id == project.id))]
    if scene_ids:
        session.exec(delete(SceneAsset).where(col(SceneAsset.scene_id).in_(scene_ids)))
        session.exec(delete(SceneCandidate).where(col(SceneCandidate.scene_id).in_(scene_ids)))
        for scene in session.exec(select(Scene).where(col(Scene.id).in_(scene_ids))):
            scene.approved_asset_id = None
    prefix = project.folder_path.rstrip("/") + "/"
    session.exec(delete(Asset).where(col(Asset.file_path).startswith(prefix)))
    session.flush()


def approved_file(session: Session, scene_id: int, asset_id: int) -> Path:
    row = session.get(SceneAsset, (scene_id, asset_id))
    if not row or not row.file_path or not _abs(row.file_path).exists():
        raise NotFound("El medio aprobado no está en disco")
    return _abs(row.file_path)


def asset_file(session: Session, asset_id: int, thumb: bool = False) -> Path:
    asset = session.get(Asset, asset_id)
    if not asset:
        raise NotFound("El medio no existe")
    rel = asset.thumb_path if thumb else asset.file_path
    if not rel or not _abs(rel).exists():
        raise NotFound("El archivo no está en disco")
    return _abs(rel)
