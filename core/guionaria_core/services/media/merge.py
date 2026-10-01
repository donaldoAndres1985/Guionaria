"""Fusionar dos videos en uno (sección 5.6): cuando ningún candidato solo alcanza para la
escena, se unen dos clips descargados uno detrás del otro con FFmpeg; la duración del medio
resultante es la suma de ambos. Queda como un candidato más (el primero sin principal queda
aprobado), igual que un archivo agregado a mano."""

import asyncio
import subprocess
import sys
from pathlib import Path

from sqlmodel import Session

from ...config import get_paths
from ...models import Asset, Project, Scene
from ...util.paths import check_path_length
from ..errors import DomainError
from ..jobs import JobContext
from ..projects import project_dir
from . import naming
from .framing import target_size

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def _scale_pad(index: int, tw: int, th: int) -> str:
    """Cada clip se ajusta al formato de destino con barras (sin recortar ni deformar), para
    que la unión no salte de tamaño ni de proporción entre un clip y el otro."""
    return (
        f"[{index}:v]scale={tw}:{th}:force_original_aspect_ratio=decrease,"
        f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v{index}]"
    )


def concat_videos(sources: list[Path], dest: Path, tw: int, th: int) -> None:
    filters = ";".join(_scale_pad(i, tw, th) for i in range(len(sources)))
    labels = "".join(f"[v{i}]" for i in range(len(sources)))
    filter_complex = f"{filters};{labels}concat=n={len(sources)}:v=1:a=0[v]"
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    for s in sources:
        args += ["-i", str(s)]
    args += [
        "-filter_complex", filter_complex,
        "-map", "[v]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(dest),
    ]  # fmt: skip
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.run(args, capture_output=True, timeout=1800, creationflags=_NO_WINDOW)
    except FileNotFoundError as exc:
        raise DomainError("No se encontró FFmpeg. Revisa Ajustes → Dependencias.") from exc
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", errors="replace").strip().splitlines()
        raise DomainError(
            "FFmpeg no pudo fusionar los videos" + (f": {detail[-1]}" if detail else "")
        )


def validate_merge(
    session: Session, scene_id: int, asset_ids: list[int]
) -> tuple[Scene, list[Asset]]:
    from .service import _open_project, _scene_assets_for, get_scene

    if len(set(asset_ids)) != 2:
        raise DomainError("Elige dos videos distintos para fusionar")
    scene = get_scene(session, scene_id)
    _open_project(session, scene.project_id)
    downloaded = _scene_assets_for(session, scene)
    assets = []
    for asset_id in asset_ids:
        if asset_id not in downloaded:
            raise DomainError("Ese medio no es un candidato descargado de esta escena")
        asset = session.get(Asset, asset_id)
        if not asset or asset.kind != "video":
            raise DomainError("Solo se pueden fusionar videos")
        if not asset.duration_s:
            raise DomainError("No se conoce la duración de uno de los videos")
        assets.append(asset)
    return scene, assets


async def merge_assets(
    session_factory, scene_id: int, asset_ids: list[int], ctx: JobContext
) -> dict:
    from .service import _approved, approve_asset, create_asset, get_scene, process_file

    home = get_paths().home
    with session_factory() as session:
        scene, assets = validate_merge(session, scene_id, asset_ids)
        project = session.get(Project, scene.project_id)
        tw, th = target_size(project)
        sources = [home / a.file_path for a in assets]
        for path in sources:
            if not path.exists():
                raise DomainError("Falta alguno de los videos originales en disco")
        total_duration = round(sum(a.duration_s or 0 for a in assets), 2)
        folder = project_dir(project) / "media" / "candidates"
        provider_id = f"fusion-{assets[0].id}-{assets[1].id}"
        name = naming.candidate_name(scene, "manual", provider_id, ".mp4")
        dest = folder / name
        check_path_length(dest)

    ctx.progress(0.1, f"Fusionando 2 videos para la escena {scene.position}…")
    await asyncio.to_thread(concat_videos, sources, dest, tw, th)
    ctx.progress(0.7, "Procesando el video fusionado…")
    processed = await process_file(dest, "video")

    with session_factory() as session:
        from ...models import SceneCandidate

        scene = get_scene(session, scene_id)
        asset = create_asset(
            session,
            processed,
            provider="manual",
            provider_id=None,
            page_url=None,
            file_url=None,
            author=None,
            license=None,
            fallback=(tw, th, total_duration),
        )
        session.add(
            SceneCandidate(
                scene_id=scene_id,
                provider="manual",
                kind="video",
                width=asset.width,
                height=asset.height,
                duration_s=asset.duration_s,
                selected=1,
                download_status="manual",
                asset_id=asset.id,
            )
        )
        has_main = any(r.role == "main" for r in _approved(session, scene_id))
        session.commit()
        if not has_main:
            approve_asset(session, scene_id, asset.id, "main")
        return {
            "asset_id": asset.id,
            "duration_s": asset.duration_s,
            "approved": not has_main,
        }
