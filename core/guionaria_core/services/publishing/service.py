"""Publicación de un proyecto: una fila por plataforma del canal (YouTube, TikTok, Instagram,
Facebook) con sus metadatos, la lista de verificación y el estado.

- Los textos los propone Claude (prompt «metadatos_publicacion») a partir del guion, la ficha
  verificada y las reglas del canal; la app agrega los créditos de los medios y recorta a los
  límites de cada plataforma.
- Publicar a mano: copiar los textos, abrir la plataforma y pegar la URL publicada.
- YouTube además se sube directo (youtube.py).
- Estado del proyecto: PUBLICADO en cuanto está publicado en alguna plataforma activa (las
  demás se ven como «1/3»); PROGRAMADO si aún no está en ninguna pero hay alguna con fecha.
"""

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageOps
from sqlmodel import Session, col, select

from ...config import get_paths
from ...domain.states import ORDER, ProjectStatus
from ...models import Channel, Project, Publication
from ...models._base import now_iso
from ...schemas.publishing import (
    CheckItem,
    CoverOption,
    DisenoClaude,
    MetadatosClaude,
    MiniaturaClaude,
    PublicationMeta,
    PublicationRead,
    PublicationUpdate,
    PublishingState,
    QueueItem,
    TitleIdea,
    TitulosClaude,
    YouTubeStatus,
)
from .. import prompts
from ..channels import get_channel
from ..errors import Conflict, DomainError, NotFound
from ..jobs import JobContext
from ..llm.claude_cli import ClaudeRunner, generate_structured
from ..oplog import log_operation
from ..projects import get_project, project_dir
from ..research import read_research
from ..rights import rights_report
from ..script import read_script

PLATFORMS: dict[str, dict] = {
    "youtube": {
        "label": "YouTube",
        "limits": {"title": 100, "description": 5000, "tags": 500, "hashtags": 5},
        "upload_url": "https://www.youtube.com/upload",
    },
    "tiktok": {
        "label": "TikTok",
        "limits": {"title": 150, "description": 2200, "tags": 0, "hashtags": 5},
        "upload_url": "https://www.tiktok.com/tiktokstudio/upload",
    },
    "instagram": {
        "label": "Instagram",
        "limits": {"title": 150, "description": 2200, "tags": 0, "hashtags": 5},
        "upload_url": "https://www.instagram.com/",
    },
    "facebook": {
        "label": "Facebook",
        "limits": {"title": 255, "description": 5000, "tags": 0, "hashtags": 5},
        "upload_url": "https://www.facebook.com/",
    },
}
FOLDER = "publicacion"
COVER = "miniatura.jpg"
KIDS_WORDS = ("infantil", "niños", "ninos", "kids", "children", "preescolar")
CRIME_WORDS = (
    "crimen",
    "crímenes",
    "asesinat",
    "true crime",
    "policial",
    "caso real",
    "casos real",
)


# --- utilidades ---


def _meta(pub: Publication) -> PublicationMeta:
    return (
        PublicationMeta.model_validate_json(pub.meta_json) if pub.meta_json else PublicationMeta()
    )


def _set_meta(pub: Publication, meta: PublicationMeta) -> None:
    pub.meta_json = meta.model_dump_json()


def _tags(pub: Publication) -> list[str]:
    return json.loads(pub.tags) if pub.tags else []


def _clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _channel_platforms(channel: Channel) -> list[str]:
    try:
        wanted = json.loads(channel.platforms or "[]")
    except ValueError:
        wanted = []
    return [p for p in PLATFORMS if p in wanted] or ["youtube"]


def _about(channel: Channel) -> str:
    return f"{channel.name} {channel.niche or ''} {channel.style_prompt or ''}".lower()


def is_kids_channel(channel: Channel) -> bool:
    return any(w in _about(channel) for w in KIDS_WORDS)


def _is_crime(channel: Channel) -> bool:
    return any(w in _about(channel) for w in CRIME_WORDS)


def final_video(project: Project) -> Path:
    from ..render.service import OUTPUTS, find_output

    # Se encuentra aunque se haya renombrado; si no hay, la ruta esperada (no existe).
    return find_output(project, "final") or project_dir(project) / "render" / OUTPUTS["final"]


def subtitles_file(project: Project) -> Path:
    return project_dir(project) / "subs" / "voz.srt"


def cover_path(project: Project) -> Path | None:
    """Miniatura elegida en Publicación o, si no, la sugerida por el render."""
    from ..render.service import THUMBNAIL

    for path in (
        project_dir(project) / FOLDER / COVER,
        project_dir(project) / "render" / THUMBNAIL,
    ):
        if path.exists():
            return path
    return None


def _voice_engine(session: Session, project_id: int) -> str | None:
    from ..voice.service import _data, latest_track

    return _data(latest_track(session, project_id)).get("engine")


def _hashtag_line(hashtags: list[str]) -> str:
    return " ".join("#" + re.sub(r"\s+", "", h.lstrip("#")) for h in hashtags if h.strip())


def _chapters_text(meta: PublicationMeta) -> str:
    if len(meta.chapters) < 3:  # YouTube pide al menos tres, empezando en 0:00
        return ""
    return "\n".join(f"{c.tiempo} {c.titulo}" for c in meta.chapters)


def full_text(pub: Publication, credits: str, fmt: str) -> str:
    """Texto listo para pegar: descripción, capítulos, hashtags y (YouTube/Facebook) créditos."""
    meta = _meta(pub)
    parts = [pub.description or ""]
    if pub.platform == "youtube" and fmt == "video":
        parts.append(_chapters_text(meta))
    parts.append(_hashtag_line(meta.hashtags))
    if pub.platform in ("youtube", "facebook") and credits:
        parts.append(credits)
    text = "\n\n".join(p.strip() for p in parts if p and p.strip())
    return _clip(text, PLATFORMS[pub.platform]["limits"]["description"])


SINGLE_TEXT = ("tiktok", "instagram")  # un solo texto: el título va en la primera línea


def caption(pub: Publication, credits: str, fmt: str) -> str:
    """Lo que se pega en una plataforma de texto único (TikTok, Instagram); en YouTube y
    Facebook es la descripción, porque el título va en su propio campo."""
    text = full_text(pub, credits, fmt)
    if pub.platform not in SINGLE_TEXT:
        return text
    title = (pub.title or "").strip()
    joined = f"{title}\n\n{text}".strip() if title else text
    return _clip(joined, PLATFORMS[pub.platform]["limits"]["description"])


def files_for(project: Project) -> dict[str, Path | None]:
    """Archivos que se suben a mano: el video, la miniatura y los subtítulos."""
    srt = subtitles_file(project)
    video = final_video(project)
    return {
        "video": video if video.exists() else None,
        "thumbnail": cover_path(project),
        "subtitles": srt if srt.exists() else None,
    }


# --- filas por plataforma ---


def ensure_publications(session: Session, project: Project) -> list[Publication]:
    """Una fila por plataforma del canal (se crean la primera vez)."""
    channel = get_channel(session, project.channel_id)
    rows = session.exec(
        select(Publication)
        .where(Publication.project_id == project.id)
        .order_by(col(Publication.id))
    ).all()
    have = {r.platform for r in rows}
    created = False
    for platform in _channel_platforms(channel):
        if platform in have:
            continue
        pub = Publication(
            project_id=project.id,
            platform=platform,
            title=project.title,
            description="",
            tags="[]",
            visibility="public",
            status="draft",
        )
        meta = PublicationMeta()
        if platform == "youtube":
            meta.made_for_kids = True if is_kids_channel(channel) else None
            meta.category_id = "27" if is_kids_channel(channel) else "22"
        _set_meta(pub, meta)
        session.add(pub)
        created = True
    if created:
        session.commit()
        rows = session.exec(
            select(Publication)
            .where(Publication.project_id == project.id)
            .order_by(col(Publication.id))
        ).all()
    order = list(PLATFORMS)
    return sorted(rows, key=lambda r: order.index(r.platform) if r.platform in order else 99)


def checklist(
    pub: Publication, channel: Channel, project: Project, credits: str, engine: str | None
) -> list[CheckItem]:
    meta = _meta(pub)
    text = full_text(pub, credits, project.format)
    auto = [
        ("render", "Video final renderizado", final_video(project).exists()),
        ("title", "Título elegido", bool((pub.title or "").strip())),
        ("description", "Descripción escrita", bool((pub.description or "").strip())),
    ]
    if pub.platform in ("youtube", "facebook"):
        auto.append(("thumbnail", "Miniatura", cover_path(project) is not None))
    items = [CheckItem(id=i, label=label, done=done, manual=False) for i, label, done in auto]
    if pub.platform in ("youtube", "facebook"):
        items.append(
            CheckItem(
                id="credits",
                label="Créditos de los medios en la descripción",
                done=bool(credits) and credits.strip() in text,
                manual=False,
            )
        )
    else:
        items.append(
            CheckItem(
                id="credits",
                label="Créditos en el primer comentario o en la bio",
                done=meta.checks.get("credits", False),
                manual=True,
                hint="Copia los créditos desde el panel de la izquierda",
            )
        )
    if pub.platform == "youtube":
        items.append(
            CheckItem(
                id="kids",
                label="Decidido si es contenido para niños",
                done=meta.made_for_kids is not None,
                manual=False,
                hint="Obligatorio en YouTube (COPPA)",
            )
        )
    if _is_crime(channel):
        items.append(
            CheckItem(
                id="respect",
                label="Sin detalles gráficos; víctimas y no condenados tratados con respeto",
                done=meta.checks.get("respect", False),
                manual=True,
                hint="Evita restricciones de edad y desmonetización",
            )
        )
    items.append(
        CheckItem(
            id="synthetic",
            label="Revisado si hay que avisar de contenido alterado o sintético",
            done=meta.checks.get("synthetic", False),
            manual=True,
            hint="Imágenes o voces realistas generadas que puedan confundirse con reales",
        )
    )
    if engine == "elevenlabs":
        items.append(
            CheckItem(
                id="license",
                label="Mi plan de ElevenLabs permite uso comercial (si monetizo)",
                done=meta.checks.get("license", False),
                manual=True,
                hint="El plan gratuito no lo permite",
            )
        )
    return items


def _read(pub: Publication, channel, project, credits, engine) -> PublicationRead:
    info = PLATFORMS[pub.platform]
    cover = cover_path(project)
    return PublicationRead(
        id=pub.id,
        platform=pub.platform,
        label=info["label"],
        enabled=pub.enabled,
        title=pub.title or "",
        description=pub.description or "",
        tags=_tags(pub),
        visibility=pub.visibility or "public",
        scheduled_at=pub.scheduled_at,
        published_at=pub.published_at,
        external_url=pub.external_url,
        status=pub.status or "draft",
        error=pub.error,
        meta=_meta(pub),
        checklist=checklist(pub, channel, project, credits, engine),
        limits=info["limits"],
        full_text=full_text(pub, credits, project.format),
        caption=caption(pub, credits, project.format),
        upload_url=info["upload_url"],
        thumbnail_url=(
            f"/api/projects/{project.id}/publishing/thumbnail?v={cover.stat().st_mtime_ns}"
            if cover
            else None
        ),
    )


def publishing_state(session: Session, project_id: int, redirect_uri: str = "") -> PublishingState:
    from . import youtube

    project = get_project(session, project_id)
    channel = get_channel(session, project.channel_id)
    rows = ensure_publications(session, project)
    settle_scheduled(session, project, rows)
    sync_project_status(session, project)
    credits = rights_report(session, project_id).credits
    engine = _voice_engine(session, project_id)
    video = final_video(project)
    reason = None if video.exists() else "Renderiza el video final en el Timeline para publicarlo"
    return PublishingState(
        project_id=project.id,
        channel_id=channel.id,
        channel_name=channel.name,
        format=project.format,
        can_publish=video.exists(),
        reason=reason,
        video_url=f"/api/projects/{project.id}/render/files/{quote(video.name)}"
        if video.exists()
        else None,
        video_file=str(video) if video.exists() else None,
        subtitles=subtitles_file(project).exists(),
        credits=credits,
        publications=[_read(p, channel, project, credits, engine) for p in rows],
        cover_options=cover_options(project),
        youtube=YouTubeStatus(
            configured=youtube.configured(),
            connected=youtube.is_connected(channel.id),
            account=youtube.account_name(channel.id),
            redirect_uri=redirect_uri,
        ),
    )


def settle_scheduled(session: Session, project: Project, rows: list[Publication]) -> None:
    """Lo subido con fecha (YouTube lo publica solo) cuenta como publicado al llegar la hora."""
    now = datetime.now(UTC)
    changed = False
    for pub in rows:
        due = pub.scheduled_at and datetime.fromisoformat(pub.scheduled_at) <= now
        if pub.status == "scheduled" and pub.external_id and due:
            pub.status, pub.published_at = "published", pub.scheduled_at
            changed = True
    if changed:
        session.commit()
        sync_project_status(session, project)


def _get_pub(session: Session, pub_id: int) -> Publication:
    pub = session.get(Publication, pub_id)
    if not pub:
        raise NotFound("No existe esa publicación")
    return pub


def _parse_when(value: str) -> datetime:
    try:
        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise DomainError("Fecha de publicación no válida") from exc
    if when.tzinfo is None:
        when = when.astimezone()  # hora local del equipo
    return when


def update_publication(session: Session, pub_id: int, data: PublicationUpdate) -> PublishingState:
    pub = _get_pub(session, pub_id)
    if pub.status in ("published", "uploading"):
        allowed = {"enabled", "checks"}
        if set(data.model_dump(exclude_unset=True)) - allowed:
            raise Conflict("Ya está publicada: cámbiala en la plataforma")
    limits = PLATFORMS[pub.platform]["limits"]
    meta = _meta(pub)
    fields = data.model_dump(exclude_unset=True)
    if "enabled" in fields:
        pub.enabled = data.enabled
    if data.title is not None:
        pub.title = _clip(data.title, limits["title"])
    if data.description is not None:
        pub.description = data.description
    if data.tags is not None:
        pub.tags = json.dumps([t.strip() for t in data.tags if t.strip()], ensure_ascii=False)
    if data.hashtags is not None:
        meta.hashtags = [h.strip().lstrip("#") for h in data.hashtags if h.strip()]
    if data.visibility is not None:
        pub.visibility = data.visibility
    if data.clear_schedule:
        pub.scheduled_at = None
        if pub.status == "scheduled" and not pub.external_id:
            pub.status = "draft"
    elif data.scheduled_at:
        when = _parse_when(data.scheduled_at)
        if when <= datetime.now(UTC):
            raise DomainError("La fecha programada ya pasó")
        pub.scheduled_at = when.isoformat()
        if pub.status in ("draft", "failed", None):
            pub.status = "scheduled"
    for key in (
        "pinned_comment",
        "made_for_kids",
        "synthetic",
        "playlist_id",
        "captions",
        "category_id",
    ):
        if key in fields:
            setattr(meta, key, fields[key])
    if data.checks:
        meta.checks = {**meta.checks, **data.checks}
    _set_meta(pub, meta)
    pub.updated_at = now_iso()
    session.commit()
    project = get_project(session, pub.project_id)
    sync_project_status(session, project)
    write_texts(session, project)
    return publishing_state(session, project.id)


def mark_published(session: Session, pub_id: int, url: str) -> PublishingState:
    pub = _get_pub(session, pub_id)
    if not re.match(r"https?://", url.strip()):
        raise DomainError("Pega la dirección completa de la publicación (https://…)")
    was_published = pub.status == "published" and pub.published_at
    pub.status = "published"
    pub.external_url = url.strip()
    pub.published_at = pub.published_at if was_published else now_iso()  # cambiar solo el enlace
    pub.error = None
    pub.updated_at = now_iso()
    session.commit()
    project = get_project(session, pub.project_id)
    log_operation(session, "publish", "project", project.id, {"platform": pub.platform, "url": url})
    sync_project_status(session, project)
    return publishing_state(session, project.id)


def reopen(session: Session, pub_id: int) -> PublishingState:
    """Vuelve a borrador (p. ej. se marcó publicada por error)."""
    pub = _get_pub(session, pub_id)
    pub.status = "scheduled" if pub.scheduled_at else "draft"
    pub.published_at = None
    pub.external_url = None
    pub.external_id = None
    pub.error = None
    session.commit()
    project = get_project(session, pub.project_id)
    sync_project_status(session, project)
    return publishing_state(session, project.id)


def resync_statuses(session: Session) -> int:
    """Recalcula el estado de los proyectos con publicaciones (al arrancar: por si la regla
    cambió o se editó algo fuera de la app). Devuelve cuántos cambiaron."""
    ids = {r.project_id for r in session.exec(select(Publication)).all()}
    changed = 0
    for pid in ids:
        project = session.get(Project, pid)
        if project is None or project.deleted_at:
            continue
        before = project.status
        sync_project_status(session, project)
        changed += project.status != before
    return changed


def sync_project_status(session: Session, project: Project) -> None:
    rows = session.exec(select(Publication).where(Publication.project_id == project.id)).all()
    active = [r for r in rows if r.enabled]
    if ORDER.index(project.status) < ORDER.index(ProjectStatus.RENDERIZADO):
        return
    # Publicado en cuanto el video está en alguna plataforma (el resto se ve como «1/3»);
    # programado si todavía no está en ninguna pero hay alguna con fecha.
    if any(r.status == "published" for r in active):
        new = ProjectStatus.PUBLICADO
    elif any(r.status == "scheduled" for r in active):
        new = ProjectStatus.PROGRAMADO
    else:
        new = ProjectStatus.RENDERIZADO
    if project.status != new:
        project.status = new
        project.updated_at = now_iso()
        session.commit()


# --- textos para copiar (carpeta publicacion/) ---


def write_texts(session: Session, project: Project) -> None:
    folder = project_dir(project) / FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    credits = rights_report(session, project.id).credits
    for pub in ensure_publications(session, project):
        meta = _meta(pub)
        lines = [
            f"# {PLATFORMS[pub.platform]['label']} — {project.title}",
            "",
            "## Título",
            pub.title or "",
        ]
        if meta.title_options:
            lines += ["", "Otras opciones:", *[f"- {t}" for t in meta.title_options]]
        lines += ["", "## Descripción", full_text(pub, credits, project.format)]
        if _tags(pub):
            lines += ["", "## Etiquetas", ", ".join(_tags(pub))]
        if meta.pinned_comment:
            lines += ["", "## Comentario fijado", meta.pinned_comment]
        (folder / f"{pub.platform}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


# --- metadatos con Claude ---


def _script_text(session: Session, project_id: int) -> str:
    try:
        script = read_script(session, project_id)
    except (NotFound, DomainError):
        return "(sin guion)"
    return "\n".join(s.text for s in script.segments) or "(sin guion)"


def _dossier_text(project: Project) -> tuple[str, str]:
    research = read_research(project.research_json)
    if not research:
        return project.research_notes or "(sin ficha verificada)", "Trata el caso con respeto."
    d = research.dossier
    facts = [f"- {x.afirmacion} ({x.certeza})" for x in d.datos]
    care = "; ".join(d.cuidados) or "Trata el caso con respeto."
    return d.resumen + "\n" + "\n".join(facts), care


def title_guide() -> str:
    """Guía de títulos con gancho (editable en Ajustes → Claude)."""
    return prompts.load_prompt("guia_titulos")


def _with_guide(template: str) -> str:
    # Un prompt copiado antes de existir la guía no tiene {guia_titulos}: se agrega al final.
    if "{guia_titulos}" in template:
        return template
    return template + "\n\nGuía de títulos (síguela al pie de la letra):\n{guia_titulos}\n"


def _prompt(session: Session, project: Project, channel: Channel, platforms: list[str]) -> str:
    ficha, cuidados = _dossier_text(project)
    minutes = (project.target_duration_s or 60) / 60
    chapters = (
        "- Capítulos (solo si el video dura más de 3 minutos): 3 a 8, el primero en 0:00."
        if project.format == "video" and minutes > 3
        else "- Sin capítulos (lista vacía)."
    )
    return prompts.render(
        _with_guide(prompts.load_prompt("metadatos_publicacion")),
        guia_titulos=title_guide(),
        canal=channel.name,
        estilo=channel.style_prompt or "Claro y directo.",
        nicho=channel.niche or "general",
        idioma=channel.language,
        formato="video horizontal" if project.format == "video" else "reel vertical",
        duracion=f"{minutes:.1f} min",
        titulo=project.title,
        guion=_script_text(session, project.id),
        ficha=ficha,
        plataformas=", ".join(PLATFORMS[p]["label"] for p in platforms),
        max_titulo=PLATFORMS["youtube"]["limits"]["title"],
        capitulos=chapters,
        cuidados=cuidados
        + (" Es un canal infantil: lenguaje apto para niños." if is_kids_channel(channel) else ""),
    )


def apply_metadata(session: Session, project: Project, data: MetadatosClaude) -> int:
    """Guarda lo que propuso Claude en cada plataforma que aún no está publicada."""
    by_platform = {p.plataforma: p for p in data.plataformas}
    changed = 0
    for pub in ensure_publications(session, project):
        got = by_platform.get(pub.platform)
        if not got or pub.status in ("published", "uploading"):
            continue
        limits = PLATFORMS[pub.platform]["limits"]
        meta = _meta(pub)
        titles = [_clip(t, limits["title"]) for t in got.titulos if t.strip()]
        meta.title_options = titles
        meta.hashtags = [h.strip().lstrip("#") for h in got.hashtags if h.strip()][
            : limits["hashtags"]
        ]
        meta.pinned_comment = got.comentario_fijado
        meta.chapters = data.capitulos if pub.platform == "youtube" else []
        pub.title = titles[0] if titles else pub.title
        pub.description = got.descripcion.strip()
        if pub.platform == "youtube":
            tags, total = [], 0
            for tag in (t.strip() for t in got.etiquetas if t.strip()):
                if total + len(tag) + 1 > limits["tags"]:
                    break
                tags.append(tag)
                total += len(tag) + 1
            pub.tags = json.dumps(tags, ensure_ascii=False)
        _set_meta(pub, meta)
        pub.updated_at = now_iso()
        changed += 1
    session.commit()
    write_texts(session, project)
    return changed


async def generate_metadata(
    session_factory, project_id: int, runner: ClaudeRunner, ctx: JobContext
) -> dict:
    with session_factory() as session:
        project = get_project(session, project_id)
        channel = get_channel(session, project.channel_id)
        pubs = [
            p
            for p in ensure_publications(session, project)
            if p.enabled and p.status != "published"
        ]
        platforms = [p.platform for p in pubs] or _channel_platforms(channel)
        prompt = _prompt(session, project, channel, platforms)
    ctx.progress(0.1, "Claude está escribiendo títulos, descripciones y hashtags…")
    data = await generate_structured(runner, prompt, MetadatosClaude)
    with session_factory() as session:
        project = get_project(session, project_id)
        changed = apply_metadata(session, project, data)
        log_operation(
            session,
            "publishing_metadata",
            "project",
            project_id,
            {"platforms": changed},
            actor="system",
        )
        session.commit()
    return {"platforms": changed}


# --- miniatura ---


def make_cover(
    session: Session, project_id: int, time_s: float, text: str | None
) -> PublishingState:
    """Miniatura desde el cuadro del instante `time_s` (del medio original, sin subtítulos
    quemados) con el título encima, a 1280×720 (video) o 1080×1920 (reel)."""
    import subprocess
    import tempfile

    from ..render import plan
    from ..render.thumbnail import compose
    from ..timeline.model import build_timeline

    project = get_project(session, project_id)
    m = build_timeline(session, project)
    frame_at = round(time_s * m.fps)
    span = next(
        (s for s in m.scenes if s.start <= frame_at < s.start + s.duration),
        m.scenes[-1] if m.scenes else None,
    )
    source, at = final_video(project), time_s
    if span and span.clip and span.clip.path.exists():
        source = span.clip.path
        at = (
            (span.clip.source_in + (frame_at - span.start)) / m.fps
            if span.clip.kind == "video"
            else 0.0
        )
    if not source.exists():
        raise Conflict("Renderiza el video o aprueba los medios para elegir la miniatura")
    folder = project_dir(project) / FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    size = (1280, 720) if m.width > m.height else (1080, 1920)
    with tempfile.TemporaryDirectory(prefix="guionaria-") as tmp:
        frame = Path(tmp) / "cuadro.png"
        if source.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            frame = source
        else:
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", str(source),
                 "-frames:v", "1", str(frame)],
                capture_output=True,
                check=False,
            )  # fmt: skip
            if not frame.exists():
                raise DomainError("No se pudo sacar el cuadro del video")
        with Image.open(frame) as img:
            if text and text.strip():
                cover = compose(img, text.strip(), size, plan.find_font())
            else:
                cover = ImageOps.fit(img.convert("RGB"), size, Image.Resampling.LANCZOS)
            cover.save(folder / COVER, "JPEG", quality=88)
    for pub in ensure_publications(session, project):
        meta = _meta(pub)
        meta.thumbnail_time_s, meta.thumbnail_text = time_s, text
        _set_meta(pub, meta)
        pub.thumbnail_path = str((folder / COVER).relative_to(get_paths().home))
    session.commit()
    return publishing_state(session, project_id)


# --- cola (página Publicación) ---


def queue(session: Session, channel_id: int | None = None) -> list[QueueItem]:
    q = select(Publication, Project, Channel).where(
        Publication.project_id == Project.id, Project.channel_id == Channel.id, Publication.enabled
    )
    if channel_id:
        q = q.where(Project.channel_id == channel_id)
    items = [
        QueueItem(
            id=pub.id,
            project_id=project.id,
            project_title=project.title,
            channel_id=channel.id,
            channel_name=channel.name,
            platform=pub.platform,
            label=PLATFORMS[pub.platform]["label"],
            title=pub.title or project.title,
            status=pub.status or "draft",
            scheduled_at=pub.scheduled_at,
            published_at=pub.published_at,
            external_url=pub.external_url,
            target_publish_at=project.target_publish_at,
        )
        for pub, project, channel in session.exec(q).all()
        if pub.platform in PLATFORMS
    ]
    # Primero lo pendiente (por fecha), después lo publicado (lo más reciente arriba).
    pending = sorted(
        (i for i in items if i.status != "published"),
        key=lambda i: (i.scheduled_at or i.target_publish_at or "9999", i.project_id, i.id),
    )
    done = sorted(
        (i for i in items if i.status == "published"),
        key=lambda i: i.published_at or "",
        reverse=True,
    )
    return pending + done


# --- títulos con gancho ---


async def suggest_titles(
    session_factory, pub_id: int, runner: ClaudeRunner, ctx: JobContext
) -> dict:
    """Claude propone 8 títulos con distintos tipos de gancho (guia_titulos.md)."""
    with session_factory() as session:
        pub = _get_pub(session, pub_id)
        project = get_project(session, pub.project_id)
        channel = get_channel(session, project.channel_id)
        ficha, _care = _dossier_text(project)
        limit = PLATFORMS[pub.platform]["limits"]["title"]
        prompt = prompts.render(
            _with_guide(prompts.load_prompt("titulos")),
            guia_titulos=title_guide(),
            canal=channel.name,
            plataforma=PLATFORMS[pub.platform]["label"],
            estilo=channel.style_prompt or "Claro y directo.",
            nicho=channel.niche or "general",
            idioma=channel.language,
            formato="video horizontal" if project.format == "video" else "short / reel vertical",
            titulo=project.title,
            guion=_script_text(session, project.id),
            ficha=ficha,
            max_titulo=limit,
        )
    ctx.progress(0.1, "Claude está pensando títulos con gancho…")
    data = await generate_structured(runner, prompt, TitulosClaude)
    with session_factory() as session:
        pub = _get_pub(session, pub_id)
        meta = _meta(pub)
        meta.title_ideas = [
            TitleIdea(title=_clip(t.titulo, limit), hook=t.gancho, why=t.por_que)
            for t in data.titulos
            if t.titulo.strip()
        ]
        _set_meta(pub, meta)
        session.commit()
    return {"titles": len(meta.title_ideas)}


# --- miniatura diseñada con Claude ---

COVERS = "miniaturas"


def _covers_dir(project: Project) -> Path:
    return project_dir(project) / FOLDER / COVERS


def _cover_size(project: Project) -> tuple[int, int]:
    return (1280, 720) if project.format == "video" else (1080, 1920)


def _designs(project: Project) -> list[DisenoClaude]:
    path = _covers_dir(project) / "disenos.json"
    if not path.exists():
        return []
    return [DisenoClaude.model_validate(d) for d in json.loads(path.read_text(encoding="utf-8"))]


def _save_designs(project: Project, designs: list[DisenoClaude]) -> None:
    path = _covers_dir(project) / "disenos.json"
    path.write_text(json.dumps([d.model_dump() for d in designs], ensure_ascii=False), "utf-8")


def cover_options(project: Project) -> list[CoverOption]:
    out = []
    for i, design in enumerate(_designs(project), start=1):
        path = _covers_dir(project) / f"opcion_{i}.jpg"
        if path.exists():
            out.append(
                CoverOption(
                    index=i,
                    url=f"/api/projects/{project.id}/publishing/cover/{i}?v={path.stat().st_mtime_ns}",
                    design=design,
                )
            )
    return out


def cover_option_path(session: Session, project_id: int, index: int) -> Path:
    path = _covers_dir(get_project(session, project_id)) / f"opcion_{index}.jpg"
    if not path.exists():
        raise NotFound("No existe esa propuesta de miniatura")
    return path


def _draw_option(folder: Path, size: tuple[int, int], index: int, design: DisenoClaude) -> None:
    from . import cover

    frames = cover.saved_frames(folder / "cuadros")
    frame = frames.get(design.cuadro)
    if frame is None:
        raise DomainError(f"No existe el cuadro {design.cuadro}")
    image = cover.load_frame(frame, folder / "cuadros")
    cover.render(design, image, size).save(folder / f"opcion_{index}.jpg", "JPEG", quality=90)


class CoverFrames:
    """Cuadros del video listos para decidir la miniatura (cuadro_NN.jpg en `folder`)."""

    def __init__(self, folder: Path, names: list[str], size: tuple[int, int], values: dict):
        self.folder, self.names, self.size, self.values = folder, names, size, values

    @property
    def numbers(self) -> set[int]:
        return {int(n[7:9]) for n in self.names}

    def brief(self) -> str:
        w, h = self.size
        shape = "horizontal 16:9" if w > h else "vertical 9:16"
        return prompts.render(
            prompts.load_prompt("miniatura"),
            **self.values,
            tamano=f"{w}×{h} ({shape})",
            n=len(self.names),
            archivos=", ".join(self.names),
        )


def prepare_cover_frames(session_factory, project_id: int) -> CoverFrames:
    """Saca un cuadro por escena (del medio original) para que Claude los mire."""
    from ..timeline.model import build_timeline
    from . import cover

    with session_factory() as session:
        project = get_project(session, project_id)
        youtube = next(
            (p for p in ensure_publications(session, project) if p.platform == "youtube"), None
        )
        chosen_title = (youtube.title if youtube else None) or project.title
        project = get_project(session, project_id)
        channel = get_channel(session, project.channel_id)
        m = build_timeline(session, project)
        covers = _covers_dir(project)
        size = _cover_size(project)
        values = {
            "canal": channel.name,
            "estilo": channel.style_prompt or "Claro y directo.",
            "nicho": channel.niche or "general",
            "idioma": channel.language,
            "titulo": project.title,
            "titulo_publicacion": chosen_title,
        }
    frames = cover.pick_frames(m)
    if not frames:
        raise Conflict("Aprueba los medios para elegir el cuadro de la miniatura")
    folder = covers / "cuadros"
    names = cover.write_previews(frames, folder)
    if not names:
        raise DomainError("No se pudieron sacar los cuadros del video")
    return CoverFrames(folder, names, size, values)


def draw_designs(frames: CoverFrames, designs: list[DisenoClaude]) -> list[Path]:
    """Dibuja las propuestas (reemplaza las anteriores) y guarda sus diseños."""
    wrong = [d.cuadro for d in designs if d.cuadro not in frames.numbers]
    if wrong:
        raise DomainError(f"Cuadros inexistentes: {wrong}; usa solo {sorted(frames.numbers)}")
    covers = frames.folder.parent
    for old in covers.glob("opcion_*.jpg"):
        old.unlink()
    out = []
    for i, design in enumerate(designs, start=1):
        _draw_option(covers, frames.size, i, design)
        out.append(covers / f"opcion_{i}.jpg")
    (covers / "disenos.json").write_text(
        json.dumps([d.model_dump() for d in designs], ensure_ascii=False), "utf-8"
    )
    return out


async def design_cover(
    session_factory, project_id: int, runner: ClaudeRunner, ctx: JobContext
) -> dict:
    """Claude mira los cuadros del video y diseña 3 miniaturas; la app las dibuja."""
    import asyncio

    ctx.progress(0.05, "Sacando los cuadros del video…")
    frames = await asyncio.to_thread(prepare_cover_frames, session_factory, project_id)

    def check(data: MiniaturaClaude) -> None:
        wrong = [d.cuadro for d in data.disenos if d.cuadro not in frames.numbers]
        if wrong:
            raise ValueError(f"Cuadros inexistentes: {wrong}; usa solo {sorted(frames.numbers)}")

    ctx.progress(0.15, "Claude está mirando los cuadros y diseñando…")
    data = await generate_structured(
        runner, frames.brief(), MiniaturaClaude, cwd=frames.folder, check=check, tools=["Read"]
    )
    ctx.progress(0.85, "Dibujando las propuestas…")
    await asyncio.to_thread(draw_designs, frames, data.disenos)
    return {"options": len(data.disenos)}


def redraw_cover(
    session: Session, project_id: int, index: int, design: DisenoClaude
) -> PublishingState:
    """Vuelve a dibujar una propuesta con cambios (texto, plantilla, color…), sin Claude."""
    project = get_project(session, project_id)
    designs = _designs(project)
    if not 1 <= index <= len(designs):
        raise NotFound("No existe esa propuesta de miniatura")
    _draw_option(_covers_dir(project), _cover_size(project), index, design)
    designs[index - 1] = design
    _save_designs(project, designs)
    return publishing_state(session, project_id)


def choose_cover(session: Session, project_id: int, index: int) -> PublishingState:
    import shutil

    project = get_project(session, project_id)
    source = cover_option_path(session, project_id, index)
    target = project_dir(project) / FOLDER / COVER
    shutil.copyfile(source, target)
    design = _designs(project)[index - 1]
    for pub in ensure_publications(session, project):
        meta = _meta(pub)
        meta.thumbnail_text = design.texto
        _set_meta(pub, meta)
        pub.thumbnail_path = str(target.relative_to(get_paths().home))
    session.commit()
    return publishing_state(session, project_id)


MAX_COVER_BYTES = 2 * 1024 * 1024  # límite de YouTube para miniaturas


def upload_cover(session: Session, project_id: int, source: Path) -> PublishingState:
    """Miniatura propia (hecha con otra herramienta): se encuadra al tamaño del formato y se
    guarda en JPEG por debajo de 2 MB."""
    import io

    from PIL import UnidentifiedImageError

    project = get_project(session, project_id)
    try:
        with Image.open(source) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise DomainError("No es una imagen válida (usa JPG, PNG o WebP)") from exc
    size = _cover_size(project)
    img = ImageOps.fit(img, size, Image.Resampling.LANCZOS)
    for quality in (92, 85, 78, 70, 60):
        buffer = io.BytesIO()
        img.save(buffer, "JPEG", quality=quality, optimize=True)
        if buffer.tell() <= MAX_COVER_BYTES:
            break
    target = project_dir(project) / FOLDER / COVER
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(buffer.getvalue())
    for pub in ensure_publications(session, project):
        meta = _meta(pub)
        meta.thumbnail_text = None
        _set_meta(pub, meta)
        pub.thumbnail_path = str(target.relative_to(get_paths().home))
    session.commit()
    return publishing_state(session, project_id)
