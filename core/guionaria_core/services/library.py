"""Biblioteca global de medios (sección 5.11): todo lo descargado o agregado en todos los
proyectos, con filtros, duplicados por hash y reutilización en otro proyecto sin duplicar el
archivo en disco (enlace duro)."""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session, col, select

from ..config import get_paths
from ..models import Asset, Channel, Project, Scene, SceneAsset, SceneCandidate
from ..schemas.media import AssetRead, SceneMediaRead
from .errors import Conflict, NotFound
from .media import dedup, naming
from .media import service as media
from .oplog import log_operation

Sort = Literal["recent", "size", "name"]
Usage = Literal["approved", "unused"]
BACKFILL_BATCH = 200


class UsageRead(BaseModel):
    scene_id: int
    position: int
    role: str


class LibraryItem(BaseModel):
    asset: AssetRead
    project_id: int | None
    project_title: str | None
    project_format: str | None
    channel_id: int | None
    channel_name: str | None
    used_in: list[UsageRead]
    duplicates: int  # otros medios con el mismo contenido
    reused_from_id: int | None
    created_at: str


class Facet(BaseModel):
    value: str
    count: int


class LibraryPage(BaseModel):
    items: list[LibraryItem]
    total: int
    total_bytes: int
    page: int
    page_size: int
    kinds: list[Facet]
    providers: list[Facet]
    orientations: list[Facet]


class LibraryStats(BaseModel):
    assets: int
    bytes: int  # suma de los tamaños de cada medio
    unique_bytes: int  # contando una sola vez cada contenido repetido
    saved_bytes: int
    duplicate_groups: int


# --- relaciones ---


def _origins(session: Session) -> dict[int, tuple[Project, Channel]]:
    """Proyecto (y canal) de cada medio, a través del candidato que lo trajo."""
    rows = session.exec(
        select(SceneCandidate.asset_id, Project, Channel)
        .join(Scene, Scene.id == SceneCandidate.scene_id)
        .join(Project, Project.id == Scene.project_id)
        .join(Channel, Channel.id == Project.channel_id)
        .where(col(SceneCandidate.asset_id).is_not(None))
    ).all()
    out: dict[int, tuple[Project, Channel]] = {}
    for asset_id, project, channel in rows:
        out.setdefault(asset_id, (project, channel))
    return out


def _usages(session: Session) -> dict[int, list[UsageRead]]:
    rows = session.exec(
        select(SceneAsset, Scene.position).join(Scene, Scene.id == SceneAsset.scene_id)
    ).all()
    out: dict[int, list[UsageRead]] = {}
    for row, position in rows:
        out.setdefault(row.asset_id, []).append(
            UsageRead(scene_id=row.scene_id, position=position, role=row.role)
        )
    return out


def backfill_hashes(session: Session, limit: int = BACKFILL_BATCH) -> int:
    """Calcula el SHA-256 de los medios anteriores a la biblioteca (por tandas)."""
    home = get_paths().home
    pending = session.exec(select(Asset).where(col(Asset.sha256).is_(None)).limit(limit)).all()
    done = 0
    for asset in pending:
        path = home / asset.file_path
        if path.exists():
            asset.sha256 = dedup.file_sha256(path)
            done += 1
    if pending:
        session.commit()
    return done


# --- listado ---


def _facets(values: list[str | None]) -> list[Facet]:
    counts: dict[str, int] = {}
    for v in values:
        if v:
            counts[v] = counts.get(v, 0) + 1
    return [Facet(value=k, count=n) for k, n in sorted(counts.items(), key=lambda kv: -kv[1])]


def list_library(
    session: Session,
    *,
    kind: str | None = None,
    channel_id: int | None = None,
    project_id: int | None = None,
    provider: str | None = None,
    license: str | None = None,
    orientation: str | None = None,
    usage: Usage | None = None,
    duplicates: bool = False,
    q: str | None = None,
    sort: Sort = "recent",
    page: int = 1,
    page_size: int = 60,
) -> LibraryPage:
    backfill_hashes(session)
    home = get_paths().home
    origins = _origins(session)
    usages = _usages(session)
    assets = [a for a in session.exec(select(Asset)).all() if (home / a.file_path).exists()]
    by_hash: dict[str, int] = {}
    for a in assets:
        if a.sha256:
            by_hash[a.sha256] = by_hash.get(a.sha256, 0) + 1

    def keep(a: Asset) -> bool:
        project, channel = origins.get(a.id, (None, None))
        if channel_id is not None and (not channel or channel.id != channel_id):
            return False
        if project_id is not None and (not project or project.id != project_id):
            return False
        if provider and a.provider != provider:
            return False
        if license and license.lower() not in (a.license or "").lower():
            return False
        if orientation and a.orientation != orientation:
            return False
        if usage == "approved" and a.id not in usages:
            return False
        if usage == "unused" and a.id in usages:
            return False
        if duplicates and by_hash.get(a.sha256 or "", 0) < 2:
            return False
        if q:
            text = " ".join(
                filter(None, [Path(a.file_path).name, a.author, a.source_page_url, a.provider_id])
            ).lower()
            if q.lower() not in text:
                return False
        return True

    # Las facetas se calculan sin el filtro de su propia dimensión... salvo el tipo, que son
    # pestañas: se cuentan sobre el resto de filtros.
    filtered_no_kind = [a for a in assets if keep(a)]
    filtered = [a for a in filtered_no_kind if not kind or a.kind == kind]
    key = {
        "recent": lambda a: (a.created_at, a.id),
        "size": lambda a: (a.size_bytes or 0, a.id),
        "name": lambda a: Path(a.file_path).name.lower(),
    }[sort]
    filtered.sort(key=key, reverse=sort != "name")
    start = (page - 1) * page_size

    def item(a: Asset) -> LibraryItem:
        project, channel = origins.get(a.id, (None, None))
        return LibraryItem(
            asset=media.asset_read(a),
            project_id=project.id if project else None,
            project_title=project.title if project else None,
            project_format=project.format if project else None,
            channel_id=channel.id if channel else None,
            channel_name=channel.name if channel else None,
            used_in=sorted(usages.get(a.id, []), key=lambda u: u.position),
            duplicates=by_hash.get(a.sha256 or "", 1) - 1 if a.sha256 else 0,
            reused_from_id=a.reused_from_id,
            created_at=a.created_at,
        )

    return LibraryPage(
        items=[item(a) for a in filtered[start : start + page_size]],
        total=len(filtered),
        total_bytes=sum(a.size_bytes or 0 for a in filtered),
        page=page,
        page_size=page_size,
        kinds=_facets([a.kind for a in filtered_no_kind]),
        providers=_facets([a.provider for a in filtered]),
        orientations=_facets([a.orientation for a in filtered]),
    )


def library_stats(session: Session) -> LibraryStats:
    backfill_hashes(session)
    home = get_paths().home
    assets = [a for a in session.exec(select(Asset)).all() if (home / a.file_path).exists()]
    total = sum(a.size_bytes or 0 for a in assets)
    seen: dict[str, int] = {}
    unique = 0
    for a in assets:
        if not a.sha256:
            unique += a.size_bytes or 0
        elif a.sha256 not in seen:
            seen[a.sha256] = 1
            unique += a.size_bytes or 0
        else:
            seen[a.sha256] += 1
    return LibraryStats(
        assets=len(assets),
        bytes=total,
        unique_bytes=unique,
        saved_bytes=total - unique,
        duplicate_groups=sum(1 for n in seen.values() if n > 1),
    )


# --- reutilizar ---


def reuse_asset(session: Session, asset_id: int, scene_id: int) -> SceneMediaRead:
    """Agrega un medio de la biblioteca como candidato descargado de otra escena.
    Queda en la carpeta del proyecto destino como enlace duro: no ocupa espacio de nuevo."""
    home = get_paths().home
    source_asset = session.get(Asset, asset_id)
    if not source_asset:
        raise NotFound("El medio no existe")
    source = home / source_asset.file_path
    if not source.exists():
        raise Conflict("El archivo del medio ya no está en disco")
    scene = media.get_scene(session, scene_id)
    project = media._open_project(session, scene.project_id)
    if scene.media_kind not in ("video", "image", "real"):
        raise Conflict("Esta escena no lleva medio (texto o negro)")

    # Si la escena ya tiene ese contenido, no se agrega otra vez.
    for c in session.exec(select(SceneCandidate).where(SceneCandidate.scene_id == scene_id)):
        existing = session.get(Asset, c.asset_id) if c.asset_id else None
        if existing and (existing.id == asset_id or existing.sha256 == source_asset.sha256):
            return media.scene_media(session, scene_id)

    folder = media.project_dir(project) / "media" / "candidates"
    provider_id = source_asset.provider_id or str(source_asset.id)
    dest = folder / (
        naming.candidate_name(scene, source_asset.provider, provider_id, "") + source.suffix
    )
    media.check_path_length(dest)
    dedup.link_or_copy(source, dest)
    thumb = None
    if source_asset.thumb_path and (home / source_asset.thumb_path).exists():
        thumb = dest.parent / ".thumbs" / f"{dest.stem}.jpg"
        dedup.link_or_copy(home / source_asset.thumb_path, thumb)

    new = Asset(
        **source_asset.model_dump(
            exclude={"id", "file_path", "thumb_path", "created_at", "reused_from_id"}
        ),
        file_path=media._rel(dest),
        thumb_path=media._rel(thumb) if thumb else None,
        reused_from_id=source_asset.id,
    )
    session.add(new)
    session.flush()
    session.add(
        SceneCandidate(
            scene_id=scene_id,
            provider=source_asset.provider,
            provider_id=provider_id,
            kind="video" if source_asset.kind == "video" else "image",
            page_url=source_asset.source_page_url,
            full_url=source_asset.source_file_url,
            width=source_asset.width,
            height=source_asset.height,
            duration_s=source_asset.duration_s,
            license=source_asset.license,
            author=source_asset.author,
            query="biblioteca",
            selected=1,
            download_status="done",
            asset_id=new.id,
        )
    )
    if scene.status == "pending":
        scene.status = "candidates"
    media._enter_media_stage(project)
    log_operation(session, "reuse", "asset", new.id, {"from": asset_id, "scene": scene_id})
    session.commit()
    return media.scene_media(session, scene_id)
