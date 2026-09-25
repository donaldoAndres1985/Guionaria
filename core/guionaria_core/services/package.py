"""Paquete del proyecto (sección 5.10): la carpeta queda lista para editar fuera de la app.

Escribe guion.md, escenas.md, escenas.csv, creditos.txt y LEEME.txt en la carpeta del proyecto.
"""

from pathlib import Path

from pydantic import BaseModel
from sqlmodel import Session, col, select

from ..models import Asset, Scene, SceneAsset
from ..schemas.scene import TIPO_FROM_KIND
from .errors import Conflict
from .projects import get_project, project_dir
from .scenes import list_scenes, mmss, to_csv, to_markdown
from .script import _segments, _write_script_md, current_version

STOCK = {"pexels": "Pexels", "pixabay": "Pixabay"}
GROUP_TITLE = {
    **STOCK,
    "tercero": "Material de terceros (revisa los derechos antes de publicar)",
    "propio": "Material propio",
}


def _group(asset: Asset) -> str:
    """Bancos de stock por nombre; lo manual con URL de origen es de terceros, sin URL es propio."""
    if asset.provider in STOCK:
        return asset.provider
    return "tercero" if asset.source_page_url or asset.source_file_url else "propio"


class PackageResult(BaseModel):
    folder: str
    files: list[str]
    missing_media: list[int]


def _approved_by_scene(
    session: Session, project_id: int
) -> dict[int, list[tuple[SceneAsset, Asset]]]:
    scene_ids = [s.id for s in session.exec(select(Scene).where(Scene.project_id == project_id))]
    rows = session.exec(select(SceneAsset).where(col(SceneAsset.scene_id).in_(scene_ids))).all()
    out: dict[int, list[tuple[SceneAsset, Asset]]] = {}
    for row in rows:
        asset = session.get(Asset, row.asset_id)
        if asset:
            out.setdefault(row.scene_id, []).append((row, asset))
    for items in out.values():
        items.sort(key=lambda pair: pair[0].role != "main")
    return out


def credits_text(title: str, scenes, approved) -> str:
    """Créditos para la descripción del video (sección 19): origen, autor y licencia."""
    lines = [f"Créditos — {title}", ""]
    groups: dict[str, list[str]] = {}
    sources: list[str] = []
    for scene in scenes:
        for row, asset in approved.get(scene.id, []):
            if row.role != "main":
                continue
            group = _group(asset)
            where = asset.source_page_url or asset.source_file_url or ""
            who = asset.author or ("autor sin identificar" if group != "propio" else "")
            license_ = f" — {asset.license}" if asset.license else ""
            detail = f": {who}{license_}" if who or license_ else ""
            groups.setdefault(group, []).append(
                f"  · Escena {scene.position} ({mmss(scene.start_s)}){detail}"
                + (f"\n    {where}" if where else "")
            )
            if group == "tercero" and where and where not in sources:
                sources.append(where)
    if not groups:
        lines.append("Todavía no hay medios aprobados.")
    for group in (*STOCK, "tercero", "propio"):
        if group in groups:
            lines += [GROUP_TITLE[group] + ":", *groups[group], ""]

    banks = [STOCK[g] for g in STOCK if g in groups]
    suggested = []
    if banks:
        suggested.append(f"Imágenes y videos de {', '.join(banks)}.")
    if sources:
        suggested.append("Fuentes: " + " · ".join(sources))
        suggested.append(
            "Material de terceros usado con fines informativos y de comentario; "
            "los derechos pertenecen a sus autores."
        )
    if not suggested:
        suggested.append("Material propio.")
    lines += ["Texto sugerido para la descripción:", *suggested]
    return "\n".join(lines) + "\n"


def readme_text(project, state, approved) -> str:
    fmt = "Video 16:9 (1920×1080)" if project.format == "video" else "Reel 9:16 (1080×1920)"
    lines = [
        f"{project.title}",
        f"{fmt} · {len(state.scenes)} escenas · duración estimada {mmss(state.total_s)}",
        "",
        "Carpetas:",
        "  media/approved/  medios elegidos, nombrados {escena}_{inicio mmss}_{tipo}_{descripción}",
        "  media/candidates/, media/manual/  el resto de lo descargado o agregado",
        "  guion.md, escenas.md/.csv  guion y tabla de escenas · creditos.txt  fuentes y licencias",
        "",
        "Escenas (tiempos estimados; se ajustan con la voz en la siguiente fase):",
        "",
    ]
    header = f"{'#':>3}  {'Inicio–Fin':<11}  {'Tipo':<7}  Archivo / notas"
    lines += [header, "-" * len(header)]
    for s in state.scenes:
        files = [Path(row.file_path).name for row, _ in approved.get(s.id, []) if row.file_path]
        needs = s.media_kind in ("video", "image", "real")
        media = (
            ", ".join(files) if files else ("FALTA MEDIO" if needs else "(se genera en edición)")
        )
        lines.append(
            f"{s.position:>3}  {mmss(s.start_s) + '–' + mmss(s.end_s):<11}  "
            f"{TIPO_FROM_KIND[s.media_kind]:<7}  {media}"
        )
        extras = [
            f"efecto: {s.effect}" if s.effect and s.effect != "ninguno" else "",
            f"texto: «{s.on_screen_text}»" if s.on_screen_text else "",
            f"SFX: {s.sfx}" if s.sfx else "",
            f"música: {s.music_cue}" if s.music_cue else "",
        ]
        extras = [e for e in extras if e]
        if extras:
            lines.append(" " * 27 + " · ".join(extras))
    return "\n".join(lines) + "\n"


def export_package(session: Session, project_id: int) -> PackageResult:
    project = get_project(session, project_id)
    state = list_scenes(session, project_id)
    if not state.scenes:
        raise Conflict("Genera las escenas antes de exportar el paquete")
    folder = project_dir(project)
    approved = _approved_by_scene(session, project_id)
    scenes = session.exec(
        select(Scene).where(Scene.project_id == project_id).order_by(col(Scene.position))
    ).all()

    version = current_version(session, project_id)
    if version:
        _write_script_md(project, _segments(session, version))
    (folder / "escenas.md").write_text(to_markdown(project, state), encoding="utf-8")
    (folder / "escenas.csv").write_text(to_csv(state), encoding="utf-8-sig")
    (folder / "creditos.txt").write_text(
        credits_text(project.title, scenes, approved), encoding="utf-8"
    )
    (folder / "LEEME.txt").write_text(readme_text(project, state, approved), encoding="utf-8")

    files = [
        f
        for f in ("guion.md", "escenas.md", "escenas.csv", "creditos.txt", "LEEME.txt")
        if (folder / f).exists()
    ]
    missing = [
        s.position
        for s in scenes
        if s.media_kind in ("video", "image", "real")
        and not any(r.role == "main" for r, _ in approved.get(s.id, []))
    ]
    return PackageResult(folder=str(folder), files=files, missing_media=missing)
