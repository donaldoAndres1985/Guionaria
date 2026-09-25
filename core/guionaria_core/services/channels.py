import json
import os
import shutil

from sqlalchemy import func
from sqlmodel import Session, select

from ..config import get_paths
from ..models import Channel, Project
from ..models._base import now_iso
from ..schemas.channel import ChannelCreate, ChannelRead, ChannelUpdate
from ..util.slug import slugify
from .errors import Conflict, NotFound
from .oplog import log_operation


def _project_counts(session: Session) -> dict[int, int]:
    rows = session.exec(select(Project.channel_id, func.count()).group_by(Project.channel_id)).all()
    return dict(rows)


def to_read(channel: Channel, project_count: int) -> ChannelRead:
    return ChannelRead(
        id=channel.id,
        name=channel.name,
        slug=channel.slug,
        platforms=json.loads(channel.platforms or "[]"),
        language=channel.language,
        niche=channel.niche,
        style_prompt=channel.style_prompt,
        script_template=channel.script_template,
        words_per_second=channel.words_per_second,
        default_voice=channel.default_voice,
        project_count=project_count,
        created_at=channel.created_at,
        updated_at=channel.updated_at,
    )


def list_channels(session: Session) -> list[ChannelRead]:
    counts = _project_counts(session)
    channels = session.exec(select(Channel).order_by(Channel.name)).all()
    return [to_read(c, counts.get(c.id, 0)) for c in channels]


def get_channel(session: Session, channel_id: int) -> Channel:
    channel = session.get(Channel, channel_id)
    if not channel:
        raise NotFound("El canal no existe")
    return channel


def read_channel(session: Session, channel_id: int) -> ChannelRead:
    channel = get_channel(session, channel_id)
    return to_read(channel, _project_counts(session).get(channel.id, 0))


def _unique_slug(session: Session, name: str) -> str:
    base = slugify(name)
    slug, n = base, 2
    while session.exec(select(Channel).where(Channel.slug == slug)).first():
        slug, n = f"{base}-{n}", n + 1
    return slug


def create_channel(session: Session, data: ChannelCreate) -> ChannelRead:
    # El slug nombra la carpeta del canal y no cambia aunque se renombre.
    slug = _unique_slug(session, data.name)
    channel = Channel(
        **data.model_dump(exclude={"platforms"}),
        slug=slug,
        platforms=json.dumps(data.platforms),
    )
    session.add(channel)
    session.flush()

    channel_dir = get_paths().channels_dir / slug
    (channel_dir / "brand").mkdir(parents=True, exist_ok=True)
    (channel_dir / "projects").mkdir(parents=True, exist_ok=True)

    log_operation(session, "create", "channel", channel.id, {"name": channel.name})
    session.commit()
    session.refresh(channel)
    return to_read(channel, 0)


def update_channel(session: Session, channel_id: int, data: ChannelUpdate) -> ChannelRead:
    channel = get_channel(session, channel_id)
    changes = data.model_dump(exclude_unset=True)
    if "platforms" in changes:
        changes["platforms"] = json.dumps(changes["platforms"] or [])
    for key, value in changes.items():
        setattr(channel, key, value)
    channel.updated_at = now_iso()
    log_operation(session, "update", "channel", channel.id, {"fields": sorted(changes)})
    session.commit()
    return read_channel(session, channel_id)


def delete_channel(session: Session, channel_id: int) -> None:
    channel = get_channel(session, channel_id)
    if _project_counts(session).get(channel.id, 0):
        raise Conflict("No se puede eliminar un canal que tiene proyectos")

    channel_dir = get_paths().channels_dir / channel.slug
    if channel_dir.exists():
        has_files = any(files for _, _, files in os.walk(channel_dir))
        if has_files:
            raise Conflict("La carpeta del canal tiene archivos (marca, logos...): muévelos antes")
        shutil.rmtree(channel_dir)

    from .ideas import delete_channel_ideas  # import local: ideas depende de proyectos

    delete_channel_ideas(session, channel.id)
    log_operation(session, "delete", "channel", channel.id, {"name": channel.name})
    session.delete(channel)
    session.commit()
