"""Encuadre y recorte de tiempo del medio aprobado (secciones 5.6 y 6 de SPEC.md).

- mode "none": el archivo aprobado es una copia del original (el editor decide el encuadre).
- mode "crop": se elige el área visible con la proporción del formato (16:9 o 9:16).
- mode "blur": el medio entero, centrado, sobre una versión desenfocada de sí mismo.

Con crop o blur, la app genera el archivo ya encuadrado a la resolución del formato en
media/approved (Pillow para imágenes, FFmpeg para videos), así el resultado es exacto en
cualquier editor. El original queda intacto. El recorte de tiempo de un video solo, sin
encuadre, no vuelve a codificar: lo aplica el timeline.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Literal

from PIL import Image, ImageFilter, ImageOps
from pydantic import BaseModel, Field, model_validator
from sqlmodel import Session

from ...config import get_paths
from ...models import Asset, Project, Scene, SceneAsset
from ...models._base import now_iso
from ...util.paths import check_path_length
from ..errors import Conflict, DomainError, NotFound
from ..jobs import JobContext
from ..oplog import log_operation
from ..projects import get_project, project_dir
from . import dedup, process

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
MIN_CLIP_S = 0.5
ASPECT_TOLERANCE = 0.02
Mode = Literal["none", "crop", "blur"]


class Crop(BaseModel):
    """Rectángulo visible en fracciones del ancho y alto del original (0–1)."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def inside(self) -> "Crop":
        if self.x + self.w > 1.0001 or self.y + self.h > 1.0001:
            raise ValueError("El recorte se sale del medio")
        return self


class FramingIn(BaseModel):
    mode: Mode = "none"
    crop: Crop | None = None
    trim_in_s: float | None = Field(default=None, ge=0)
    trim_out_s: float | None = Field(default=None, gt=0)


class FramingRead(BaseModel):
    scene_id: int
    asset_id: int
    kind: str  # image | video
    mode: Mode
    crop: Crop | None
    trim_in_s: float | None
    trim_out_s: float | None
    source_width: int | None
    source_height: int | None
    source_duration_s: float | None
    target_width: int
    target_height: int
    orientation_mismatch: bool  # el original no tiene la orientación del formato
    suggested_crop: Crop | None  # recorte centrado con la proporción del formato
    rendered: bool  # el archivo aprobado ya está encuadrado
    approved_url: str


def target_size(project: Project) -> tuple[int, int]:
    return (1920, 1080) if project.format == "video" else (1080, 1920)


def center_crop(sw: int, sh: int, tw: int, th: int) -> Crop:
    """El mayor rectángulo centrado con la proporción del destino."""
    target = tw / th
    if sw / sh > target:  # original más ancho: se recortan los lados
        w = (sh * target) / sw
        return Crop(x=round((1 - w) / 2, 6), y=0, w=round(w, 6), h=1)
    h = (sw / target) / sh
    return Crop(x=0, y=round((1 - h) / 2, 6), w=1, h=round(h, 6))


def _mismatch(sw: int | None, sh: int | None, tw: int, th: int) -> bool:
    if not sw or not sh:
        return False
    return (sw >= sh) != (tw >= th)


def load(row: SceneAsset) -> dict:
    return json.loads(row.crop_json) if row.crop_json else {}


# --- lectura ---


def _row(session: Session, scene_id: int, asset_id: int) -> tuple[Scene, SceneAsset, Asset]:
    scene = session.get(Scene, scene_id)
    row = session.get(SceneAsset, (scene_id, asset_id))
    asset = session.get(Asset, asset_id)
    if not scene or not row or not asset:
        raise NotFound("Ese medio no está aprobado en la escena")
    return scene, row, asset


def framing_read(session: Session, project: Project, row: SceneAsset, asset: Asset) -> FramingRead:
    tw, th = target_size(project)
    data = load(row)
    sw, sh = asset.width, asset.height
    return FramingRead(
        scene_id=row.scene_id,
        asset_id=row.asset_id,
        kind=asset.kind,
        mode=data.get("mode", "none"),
        crop=Crop(**data["crop"]) if data.get("crop") else None,
        trim_in_s=row.trim_in_s,
        trim_out_s=row.trim_out_s,
        source_width=sw,
        source_height=sh,
        source_duration_s=asset.duration_s,
        target_width=tw,
        target_height=th,
        orientation_mismatch=_mismatch(sw, sh, tw, th),
        suggested_crop=center_crop(sw, sh, tw, th) if sw and sh else None,
        rendered=bool(data.get("rendered")),
        approved_url=f"/api/scenes/{row.scene_id}/assets/{row.asset_id}/approved-file",
    )


def get_framing(session: Session, scene_id: int, asset_id: int) -> FramingRead:
    scene, row, asset = _row(session, scene_id, asset_id)
    return framing_read(session, get_project(session, scene.project_id), row, asset)


# --- validación ---


def _validate(data: FramingIn, asset: Asset, tw: int, th: int) -> None:
    if data.mode == "crop":
        if not data.crop:
            raise DomainError("Falta el área del recorte")
        if asset.width and asset.height:
            ratio = (data.crop.w * asset.width) / (data.crop.h * asset.height)
            if abs(ratio / (tw / th) - 1) > ASPECT_TOLERANCE:
                raise DomainError(f"El recorte debe tener la proporción del formato ({tw}×{th})")
    if asset.kind != "video" and (data.trim_in_s is not None or data.trim_out_s is not None):
        raise DomainError("El recorte de tiempo solo aplica a videos")
    start = data.trim_in_s or 0
    end = data.trim_out_s if data.trim_out_s is not None else asset.duration_s
    if end is not None:
        if asset.duration_s is not None and end > asset.duration_s + 0.05:
            raise DomainError(f"El video dura {asset.duration_s:.1f} s")
        if end - start < MIN_CLIP_S:
            raise DomainError(f"El tramo debe durar al menos {MIN_CLIP_S} s")


# --- render ---


def render_image(src: Path, dst: Path, mode: Mode, crop: Crop | None, tw: int, th: int) -> None:
    with Image.open(src) as opened:
        img = ImageOps.exif_transpose(opened).convert("RGB")
    if mode == "crop" and crop:
        box = (
            round(crop.x * img.width),
            round(crop.y * img.height),
            round((crop.x + crop.w) * img.width),
            round((crop.y + crop.h) * img.height),
        )
        out = img.crop(box).resize((tw, th), Image.Resampling.LANCZOS)
    else:  # blur
        background = ImageOps.fit(img, (tw, th), Image.Resampling.LANCZOS)
        background = background.filter(ImageFilter.GaussianBlur(radius=max(tw, th) // 40))
        background = Image.eval(background, lambda v: int(v * 0.6))  # oscurecido
        foreground = ImageOps.contain(img, (tw, th), Image.Resampling.LANCZOS)
        background.paste(foreground, ((tw - foreground.width) // 2, (th - foreground.height) // 2))
        out = background
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, "JPEG", quality=92)


def video_filter(mode: Mode, crop: Crop | None, tw: int, th: int) -> str:
    if mode == "crop" and crop:
        return (
            f"[0:v]crop=trunc(iw*{crop.w}/2)*2:trunc(ih*{crop.h}/2)*2:"
            f"trunc(iw*{crop.x}):trunc(ih*{crop.y}),scale={tw}:{th},setsar=1[v]"
        )
    return (
        f"[0:v]split[a][b];"
        f"[a]scale={tw}:{th}:force_original_aspect_ratio=increase,crop={tw}:{th},"
        f"boxblur=20:5,eq=brightness=-0.15[bg];"
        f"[b]scale={tw}:{th}:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]"
    )


def render_video(
    src: Path,
    dst: Path,
    mode: Mode,
    crop: Crop | None,
    trim_in: float | None,
    trim_out: float | None,
    tw: int,
    th: int,
) -> None:
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    if trim_in:
        args += ["-ss", f"{trim_in:.3f}"]
    if trim_out is not None:
        args += ["-to", f"{trim_out:.3f}"]
    args += [
        "-i", str(src),
        "-filter_complex", video_filter(mode, crop, tw, th),
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        str(dst),
    ]  # fmt: skip
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.run(args, capture_output=True, timeout=1800, creationflags=_NO_WINDOW)
    except FileNotFoundError as exc:
        raise DomainError("No se encontró FFmpeg. Revisa Ajustes → Dependencias.") from exc
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", errors="replace").strip().splitlines()
        raise DomainError(
            "FFmpeg no pudo encuadrar el video" + (f": {detail[-1]}" if detail else "")
        )


# --- guardado ---


def _abs(rel: str) -> Path:
    return get_paths().home / rel


def _rel(path: Path) -> str:
    return path.relative_to(get_paths().home).as_posix()


def _replace_approved(session: Session, scene: Scene, row: SceneAsset, produced: Path) -> None:
    """Pone el archivo producido (o una copia del original) como aprobado, con su nombre."""
    from .service import _expected_name

    old = _abs(row.file_path) if row.file_path else None
    target = old.parent if old else project_dir(session.get(Project, scene.project_id))
    wanted = target / _expected_name(session, scene, row, produced.suffix)
    check_path_length(wanted)
    # El aprobado puede ser un enlace duro al original: se quita la entrada y se reemplaza con
    # os.replace. Copiar encima (como hace shutil.move en Windows si el destino existe)
    # escribiría a través del enlace y cambiaría el archivo original.
    if old:
        old.unlink(missing_ok=True)
    wanted.unlink(missing_ok=True)
    os.replace(produced, wanted)
    row.file_path = _rel(wanted)


def save_framing(
    session: Session, scene_id: int, asset_id: int, data: FramingIn
) -> tuple[FramingRead, bool]:
    """Guarda el encuadre. Devuelve (estado, hace falta un trabajo en segundo plano):
    los videos con crop o blur se codifican con FFmpeg en un job."""
    from .service import _open_project

    scene, row, asset = _row(session, scene_id, asset_id)
    project = _open_project(session, scene.project_id)
    tw, th = target_size(project)
    _validate(data, asset, tw, th)
    source = _abs(asset.file_path)
    if not source.exists():
        raise Conflict("El archivo original ya no está en la carpeta del proyecto")

    row.trim_in_s = data.trim_in_s if asset.kind == "video" else None
    row.trim_out_s = data.trim_out_s if asset.kind == "video" else None
    info = {"mode": data.mode, "crop": data.crop.model_dump() if data.crop else None}
    pending_job = False
    if data.mode == "none":
        # Sin encuadre: el aprobado vuelve a ser una copia del original.
        if load(row).get("rendered"):
            tmp = source.with_name(f".copia-{row.scene_id}-{row.asset_id}{source.suffix}")
            dedup.link_or_copy(source, tmp)
            _replace_approved(session, scene, row, tmp)
    elif asset.kind == "image":
        tmp = source.with_name(f".encuadre-{row.scene_id}-{row.asset_id}.jpg")
        render_image(source, tmp, data.mode, data.crop, tw, th)
        _replace_approved(session, scene, row, tmp)
        info["rendered"] = True
    else:
        pending_job = True  # el video se codifica en segundo plano (render_framed_video)
        info["rendered"] = False
        info["pending"] = True
    row.crop_json = json.dumps(info) if data.mode != "none" else None
    project.updated_at = now_iso()
    log_operation(
        session,
        "frame",
        "asset",
        asset_id,
        {"scene": scene_id, "mode": data.mode, "trim": [data.trim_in_s, data.trim_out_s]},
    )
    session.commit()
    return framing_read(session, project, row, asset), pending_job


async def render_framed_video(
    session_factory, scene_id: int, asset_id: int, ctx: JobContext
) -> dict:
    import asyncio

    with session_factory() as session:
        scene, row, asset = _row(session, scene_id, asset_id)
        project = session.get(Project, scene.project_id)
        tw, th = target_size(project)
        data = load(row)
        mode, crop = data.get("mode", "none"), Crop(**data["crop"]) if data.get("crop") else None
        trim_in, trim_out = row.trim_in_s, row.trim_out_s
        source = _abs(asset.file_path)

    ctx.progress(0.1, f"Encuadrando el video de la escena {scene.position} con FFmpeg…")
    tmp = source.with_name(f".encuadre-{scene_id}-{asset_id}.mp4")
    try:
        await asyncio.to_thread(render_video, source, tmp, mode, crop, trim_in, trim_out, tw, th)
        duration = (await asyncio.to_thread(process.video_info, tmp)).duration_s
    except Exception:
        tmp.unlink(missing_ok=True)
        raise

    with session_factory() as session:
        scene, row, asset = _row(session, scene_id, asset_id)
        current = load(row)
        changed = (current.get("mode"), current.get("crop"), row.trim_in_s, row.trim_out_s) != (
            mode,
            data.get("crop"),
            trim_in,
            trim_out,
        )
        if changed:
            tmp.unlink(missing_ok=True)  # el encuadre cambió mientras se codificaba
            return {"stale": True}
        _replace_approved(session, scene, row, tmp)
        row.crop_json = json.dumps(
            {"mode": mode, "crop": data.get("crop"), "rendered": True, "duration_s": duration}
        )
        log_operation(session, "render", "asset", asset_id, {"scene": scene_id}, actor="system")
        name = Path(row.file_path).name
        session.commit()
    return {"duration_s": duration, "file": name}
