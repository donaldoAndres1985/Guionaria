"""SFX y música (sección 5.12): biblioteca local etiquetada, búsqueda en Freesound y sonidos
asignados a cada escena (entran al timeline en sus propias pistas)."""

import json
import re
import shutil
import unicodedata
import wave
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from ..config import get_paths, load_settings
from ..models import Scene, Sound
from ..util.paths import check_path_length
from ..util.slug import slugify
from .errors import Conflict, DomainError, NotFound
from .media import dedup, process
from .media.http import http_client
from .media.service import DownloadError, fetch_to
from .oplog import log_operation
from .projects import get_project

Kind = Literal["sfx", "music"]
AUDIO_EXT = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac"}
FREESOUND_SEARCH = "https://freesound.org/apiv2/search/text/"
FREESOUND_FIELDS = "id,name,tags,duration,license,username,previews,url"

# Etiquetas de la sección 5.12 y sinónimos en español para sugerirlas desde el nombre.
TAGS = (
    "whoosh", "impact", "static", "typewriter", "riser", "drone", "hit", "glitch", "click",
    "heartbeat", "swoosh", "boom", "suspense", "camera", "siren", "thunder", "rain", "door",
    "footsteps", "phone", "notification", "transition",
)  # fmt: skip
SYNONYMS = {
    "golpe": "impact", "impacto": "impact", "estatica": "static", "ruido": "static",
    "maquina": "typewriter", "escribir": "typewriter", "subida": "riser", "latido": "heartbeat",
    "corazon": "heartbeat", "trueno": "thunder", "lluvia": "rain", "puerta": "door",
    "pasos": "footsteps", "camara": "camera", "sirena": "siren", "telefono": "phone",
    "transicion": "transition", "zumbido": "drone", "tension": "suspense", "suspenso": "suspense",
}  # fmt: skip
MOODS = ("tensión", "misterio", "triste", "épica", "calma", "oscura", "esperanza", "acción")


class SoundRead(BaseModel):
    id: int
    kind: Kind
    title: str
    file_url: str
    provider: str
    source_url: str | None
    author: str | None
    license: str | None
    attribution: str | None  # texto que pide la licencia (va en los créditos)
    favorite_channels: list[int]  # canales que lo tienen como favorito
    duration_s: float | None
    tags: list[str]
    mood: str | None
    bpm: int | None
    size_bytes: int | None
    used_in: int  # escenas que lo usan
    created_at: str


class SoundUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    tags: list[str] | None = None
    mood: str | None = None
    bpm: int | None = Field(default=None, ge=20, le=300)
    author: str | None = None
    license: str | None = None
    attribution: str | None = Field(default=None, max_length=2000)


class TagCount(BaseModel):
    tag: str
    count: int


class FreesoundResult(BaseModel):
    freesound_id: int
    title: str
    tags: list[str]
    duration_s: float
    license: str
    author: str
    page_url: str
    preview_url: str
    saved_sound_id: int | None  # ya está en la biblioteca


class FreesoundPage(BaseModel):
    results: list[FreesoundResult]
    total: int
    page: int
    has_more: bool


# --- utilidades ---


def _plain(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def suggest_tags(text: str) -> list[str]:
    """Etiquetas conocidas que aparecen en un nombre o descripción («golpe_seco_02.wav»)."""
    out: list[str] = []
    for word in re.split(r"[^a-z]+", _plain(text)):
        tag = word if word in TAGS else SYNONYMS.get(word)
        if tag and tag not in out:
            out.append(tag)
    return out


def license_name(url: str) -> str:
    """Freesound devuelve la licencia como URL de Creative Commons."""
    u = url.lower()
    if "publicdomain/zero" in u:
        return "CC0"
    version = re.search(r"/(\d\.\d)/", u)
    v = f" {version.group(1)}" if version else ""
    if "by-nc" in u:
        return f"CC BY-NC{v}"
    if "sampling+" in u:
        return "Sampling+"
    if "/by/" in u:
        return f"CC BY{v}"
    return url


def _duration(path: Path) -> float | None:
    info = process.video_info(path)  # ffprobe también mide audio
    if info.duration_s is None and path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path)) as wf:
                return round(wf.getnframes() / wf.getframerate(), 2)
        except (wave.Error, EOFError):
            return None
    return info.duration_s


def _usage(session: Session) -> dict[int, int]:
    """Escenas y proyectos que usan cada sonido (música, SFX o audio de fondo)."""
    from ..models import Project

    counts: dict[int, int] = {}
    for project in session.exec(select(Project).where(col(Project.background_json).is_not(None))):
        if project.deleted_at:
            continue
        sid = json.loads(project.background_json or "{}").get("sound_id")
        if sid:
            counts[sid] = counts.get(sid, 0) + 1
    for scene in session.exec(
        select(Scene).where(
            col(Scene.sfx_sound_id).is_not(None) | col(Scene.music_sound_id).is_not(None)
        )
    ):
        for sid in {scene.sfx_sound_id, scene.music_sound_id} - {None}:
            counts[sid] = counts.get(sid, 0) + 1
    return counts


def sound_read(sound: Sound, used_in: int = 0) -> SoundRead:
    return SoundRead(
        id=sound.id,
        kind=sound.kind,
        title=sound.title,
        file_url=f"/api/sounds/{sound.id}/file",
        provider=sound.provider,
        source_url=sound.source_url,
        author=sound.author,
        license=sound.license,
        attribution=sound.attribution,
        favorite_channels=json.loads(sound.favorite_channels or "[]"),
        duration_s=sound.duration_s,
        tags=json.loads(sound.tags or "[]"),
        mood=sound.mood,
        bpm=sound.bpm,
        size_bytes=sound.size_bytes,
        used_in=used_in,
        created_at=sound.created_at,
    )


def get_sound(session: Session, sound_id: int) -> Sound:
    sound = session.get(Sound, sound_id)
    if not sound:
        raise NotFound("El sonido no existe")
    return sound


def sound_file(session: Session, sound_id: int) -> Path:
    path = get_paths().home / get_sound(session, sound_id).file_path
    if not path.exists():
        raise NotFound("El archivo del sonido no está en disco")
    return path


# --- biblioteca ---


def list_sounds(
    session: Session,
    kind: Kind | None = None,
    q: str | None = None,
    tag: str | None = None,
    mood: str | None = None,
    favorite_of: int | None = None,
    with_attribution: bool | None = None,
) -> list[SoundRead]:
    stmt = select(Sound).order_by(col(Sound.id).desc())
    if kind:
        stmt = stmt.where(Sound.kind == kind)
    if mood:
        stmt = stmt.where(Sound.mood == mood)
    usage = _usage(session)
    out = []
    for sound in session.exec(stmt).all():
        tags = json.loads(sound.tags or "[]")
        if tag and tag not in tags:
            continue
        if favorite_of is not None and favorite_of not in json.loads(
            sound.favorite_channels or "[]"
        ):
            continue
        if (
            with_attribution is not None
            and bool((sound.attribution or "").strip()) != with_attribution
        ):
            continue
        if q:
            haystack = _plain(" ".join([sound.title, sound.author or "", *tags, sound.mood or ""]))
            if not all(word in haystack for word in _plain(q).split()):
                continue
        out.append(sound_read(sound, usage.get(sound.id, 0)))
    return out


def tag_counts(session: Session, kind: Kind | None = None) -> list[TagCount]:
    counts: dict[str, int] = {}
    stmt = select(Sound) if not kind else select(Sound).where(Sound.kind == kind)
    for sound in session.exec(stmt):
        for tag in json.loads(sound.tags or "[]"):
            counts[tag] = counts.get(tag, 0) + 1
    return [
        TagCount(tag=t, count=n) for t, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


def _target(kind: str, title: str, ext: str) -> Path:
    folder = get_paths().library_dir / kind
    folder.mkdir(parents=True, exist_ok=True)
    base = slugify(title)[:60] or "sonido"
    target = folder / f"{base}{ext}"
    n = 2
    while target.exists():
        target = folder / f"{base}-{n}{ext}"
        n += 1
    check_path_length(target)
    return target


def _add(
    session: Session,
    source: Path,
    *,
    kind: str,
    title: str,
    provider: str,
    move: bool = False,
    **meta,
) -> Sound:
    """Guarda el archivo en la biblioteca. Si el mismo contenido ya estaba, devuelve ese."""
    ext = source.suffix.lower()
    if ext not in AUDIO_EXT:
        raise DomainError(f"Formato de audio no admitido: {ext or 'sin extensión'}")
    sha = dedup.file_sha256(source)
    existing = session.exec(select(Sound).where(Sound.sha256 == sha)).first()
    if existing:
        if move:
            source.unlink(missing_ok=True)
        return existing
    target = _target(kind, title, ext)
    if move:
        shutil.move(str(source), target)
    else:
        dedup.link_or_copy(source, target)
    home = get_paths().home
    sound = Sound(
        kind=kind,
        title=title,
        file_path=target.relative_to(home).as_posix(),
        provider=provider,
        duration_s=_duration(target),
        size_bytes=target.stat().st_size,
        sha256=sha,
        **meta,
    )
    session.add(sound)
    session.flush()
    return sound


def import_files(
    session: Session, paths: list[Path], kind: Kind, tags: list[str] | None = None
) -> list[SoundRead]:
    """Archivos o carpetas locales (packs de efectos, música descargada a mano)."""
    files: list[Path] = []
    for p in paths:
        if p.is_dir():
            files += sorted(f for f in p.rglob("*") if f.suffix.lower() in AUDIO_EXT)
        elif p.is_file():
            files.append(p)
        else:
            raise NotFound(f"No existe {p}")
    if not files:
        raise DomainError("No se encontraron archivos de audio (WAV, MP3, OGG, FLAC, M4A, AAC)")
    added = []
    for f in files:
        auto = suggest_tags(f.stem)
        sound = _add(
            session,
            f,
            kind=kind,
            title=f.stem.replace("_", " ").strip(),
            provider="manual",
            tags=json.dumps(sorted(set(auto + (tags or []))), ensure_ascii=False),
        )
        added.append(sound)
    log_operation(session, "import", "sound", None, {"files": len(added), "kind": kind})
    session.commit()
    usage = _usage(session)
    return [sound_read(s, usage.get(s.id, 0)) for s in added]


def update_sound(session: Session, sound_id: int, data: SoundUpdate) -> SoundRead:
    sound = get_sound(session, sound_id)
    changes = data.model_dump(exclude_unset=True)
    if "tags" in changes:
        tags = [t.strip().lower() for t in changes.pop("tags") or [] if t.strip()]
        sound.tags = json.dumps(sorted(set(tags)), ensure_ascii=False)
    for key, value in changes.items():
        if isinstance(value, str):
            value = value.strip() or None if key != "title" else value.strip()
        setattr(sound, key, value)
    if changes.get("attribution"):
        fill_from_attribution(sound, sound.attribution)
    session.commit()
    return sound_read(sound, _usage(session).get(sound.id, 0))


def delete_sound(session: Session, sound_id: int) -> None:
    sound = get_sound(session, sound_id)
    if _usage(session).get(sound.id):
        raise Conflict("El sonido está asignado a escenas: quítalo de ellas antes de borrarlo")
    from ..models import TimelineItem

    if session.exec(select(TimelineItem).where(TimelineItem.sound_id == sound.id)).first():
        raise Conflict(
            "El sonido está en una pista del timeline: quítalo de ahí antes de borrarlo"
        )
    (get_paths().home / sound.file_path).unlink(missing_ok=True)
    log_operation(session, "delete", "sound", sound.id, {"title": sound.title})
    session.delete(sound)
    session.commit()


# --- Freesound ---


def _freesound_key() -> str:
    key = load_settings().api_keys.freesound
    if not key:
        raise DomainError("Falta la clave de Freesound: agrégala en Ajustes → Claves de API")
    return key


async def search_freesound(
    session: Session, query: str, page: int = 1, max_duration: float | None = None
) -> FreesoundPage:
    params = {
        "query": query,
        "page": page,
        "page_size": 15,
        "fields": FREESOUND_FIELDS,
        "token": _freesound_key(),
    }
    if max_duration:
        params["filter"] = f"duration:[0 TO {max_duration}]"
    try:
        async with http_client() as client:
            resp = await client.get(FREESOUND_SEARCH, params=params)
    except httpx.HTTPError as exc:
        raise DomainError(f"No se pudo conectar con Freesound: {exc}") from exc
    if resp.status_code in (401, 403):
        raise DomainError("Freesound rechazó la clave: revísala en Ajustes → Claves de API")
    if resp.status_code >= 400:
        raise DomainError(f"Freesound respondió {resp.status_code}")
    data = resp.json()
    saved = {
        s.provider_id: s.id
        for s in session.exec(select(Sound).where(Sound.provider == "freesound")).all()
    }
    results = []
    for r in data.get("results", []):
        previews = r.get("previews") or {}
        preview = previews.get("preview-hq-mp3") or previews.get("preview-lq-mp3")
        if not preview:
            continue
        results.append(
            FreesoundResult(
                freesound_id=r["id"],
                title=Path(r.get("name") or str(r["id"])).stem,
                tags=list(r.get("tags") or [])[:12],
                duration_s=round(float(r.get("duration") or 0), 2),
                license=license_name(r.get("license") or ""),
                author=r.get("username") or "",
                page_url=r.get("url") or f"https://freesound.org/s/{r['id']}/",
                preview_url=preview,
                saved_sound_id=saved.get(str(r["id"])),
            )
        )
    return FreesoundPage(
        results=results,
        total=data.get("count", len(results)),
        page=page,
        has_more=bool(data.get("next")),
    )


async def save_freesound(
    session: Session, result: FreesoundResult, kind: Kind = "sfx"
) -> SoundRead:
    """Descarga la vista previa HQ (MP3) a la biblioteca con autor y licencia."""
    existing = session.exec(
        select(Sound).where(
            Sound.provider == "freesound", Sound.provider_id == str(result.freesound_id)
        )
    ).first()
    if existing:
        return sound_read(existing, _usage(session).get(existing.id, 0))
    tmp = get_paths().library_dir / kind / f".descarga-{result.freesound_id}.mp3"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    try:
        async with http_client() as client:
            await fetch_to(client, result.preview_url, tmp)
    except DownloadError as exc:
        raise DomainError(f"No se pudo descargar de Freesound: {exc}") from exc
    tags = sorted({t.lower() for t in result.tags} | set(suggest_tags(result.title)))
    sound = _add(
        session,
        tmp,
        kind=kind,
        title=result.title,
        provider="freesound",
        move=True,
        provider_id=str(result.freesound_id),
        source_url=result.page_url,
        author=result.author,
        license=result.license,
        tags=json.dumps(tags[:15], ensure_ascii=False),
    )
    log_operation(
        session, "download", "sound", sound.id, {"title": sound.title, "provider": "freesound"}
    )
    session.commit()
    return sound_read(sound, _usage(session).get(sound.id, 0))


# --- escenas ---


class SceneSounds(BaseModel):
    scene_id: int
    sfx: SoundRead | None
    music: SoundRead | None


def scene_sounds(session: Session, scene: Scene) -> SceneSounds:
    usage = _usage(session)
    sfx = session.get(Sound, scene.sfx_sound_id) if scene.sfx_sound_id else None
    music = session.get(Sound, scene.music_sound_id) if scene.music_sound_id else None
    return SceneSounds(
        scene_id=scene.id,
        sfx=sound_read(sfx, usage.get(sfx.id, 0)) if sfx else None,
        music=sound_read(music, usage.get(music.id, 0)) if music else None,
    )


def assign_sound(session: Session, scene_id: int, role: Kind, sound_id: int | None) -> SceneSounds:
    """Asigna (o quita, con None) el SFX o la música de una escena."""
    scene = session.get(Scene, scene_id)
    if not scene:
        raise NotFound("La escena no existe")
    get_project(session, scene.project_id)  # no en la papelera
    if sound_id is not None:
        sound = get_sound(session, sound_id)
        if sound.kind != role:
            raise DomainError("Ese sonido es de otro tipo (efecto o música)")
    if role == "sfx":
        scene.sfx_sound_id = sound_id
    else:
        scene.music_sound_id = sound_id
    log_operation(session, "assign", "sound", sound_id, {"scene": scene_id, "role": role})
    session.commit()
    return scene_sounds(session, scene)


def suggestions(session: Session, scene_id: int, role: Kind, limit: int = 6) -> list[SoundRead]:
    """Sonidos de la biblioteca que coinciden con el SFX o la música que pide la escena."""
    scene = session.get(Scene, scene_id)
    if not scene:
        raise NotFound("La escena no existe")
    wanted = scene.sfx if role == "sfx" else scene.music_cue
    if not wanted:
        return []
    words = set(_plain(wanted).split()) | set(suggest_tags(wanted))
    scored = []
    for s in list_sounds(session, kind=role):
        text = set(_plain(" ".join([s.title, *s.tags, s.mood or ""])).split())
        score = len(words & text)
        if score:
            scored.append((score, s))
    scored.sort(key=lambda pair: (-pair[0], pair[1].title))
    return [s for _score, s in scored[:limit]]


# --- atribución y favoritos ---

CC_NAMES = {
    "by attribution": "CC BY",
    "attribution-sharealike": "CC BY-SA",
    "attribution-noderivs": "CC BY-ND",
    "attribution-noncommercial": "CC BY-NC",
    "attribution-noncommercial-sharealike": "CC BY-NC-SA",
    "attribution-noncommercial-noderivs": "CC BY-NC-ND",
}


def parse_attribution(text: str) -> dict[str, str]:
    """Datos del texto de atribución, p. ej. el de incompetech:
    «"Tranquility" Kevin MacLeod (incompetech.com) / Licensed under Creative Commons: By
    Attribution 4.0 License / http://creativecommons.org/licenses/by/4.0/»
    → título, autor, licencia («CC BY 4.0») y el enlace."""
    import re

    out: dict[str, str] = {}
    first = next((line.strip() for line in text.splitlines() if line.strip()), "")
    m = re.match(r'^[«"“]([^"”»]+)[»"”]\s*(?:by\s+|de\s+|-\s*|—\s*)?([^()\n—–|,]*)', first, re.I)
    if m:
        out["title"] = m.group(1).strip()
        author = m.group(2).strip(" -—,")
        if author:
            out["author"] = author
    lic = re.search(r"creative commons:?\s*([a-z\- ]+?)\s*(\d(?:\.\d)?)", text, re.I)
    if lic:
        kind = CC_NAMES.get(re.sub(r"\s+", " ", lic.group(1).strip().lower()).removeprefix("by "))
        kind = kind or CC_NAMES.get(re.sub(r"\s+", " ", lic.group(1).strip().lower()))
        if kind:
            out["license"] = f"{kind} {lic.group(2)}"
    elif re.search(r"\bCC0\b|dominio p[uú]blico|public domain", text, re.I):
        out["license"] = "Dominio público (CC0)"
    urls = re.findall(r"https?://\S+", text)
    if urls:
        out["license_url"] = urls[-1].rstrip(".,)")
    return out


def fill_from_attribution(sound: Sound, text: str | None, title_too: bool = False) -> None:
    """Completa autor, licencia y origen (y el título si se pide) con lo que diga la
    atribución, sin pisar lo que ya esté escrito."""
    if not text:
        return
    data = parse_attribution(text)
    if data.get("author") and not sound.author:
        sound.author = data["author"]
    if data.get("license") and not sound.license:
        sound.license = data["license"]
    if data.get("license_url") and not sound.source_url:
        sound.source_url = data["license_url"]
    if title_too and data.get("title"):
        sound.title = data["title"]


def set_favorite(session: Session, sound_id: int, channel_id: int, favorite: bool) -> SoundRead:
    from .channels import get_channel

    sound = get_sound(session, sound_id)
    get_channel(session, channel_id)
    channels = set(json.loads(sound.favorite_channels or "[]"))
    if favorite:
        channels.add(channel_id)
    else:
        channels.discard(channel_id)
    sound.favorite_channels = json.dumps(sorted(channels)) if channels else None
    session.commit()
    return sound_read(sound, _usage(session).get(sound.id, 0))
