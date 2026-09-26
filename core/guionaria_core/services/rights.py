"""Registro de derechos (sección 5.15): por proyecto, cada medio aprobado con su origen, autor y
licencia, marcado para revisar si no tiene licencia clara. Exportable a CSV."""

import csv
import io
from pathlib import Path

from pydantic import BaseModel
from sqlmodel import Session, col, select

from ..models import Scene
from .package import _approved_by_scene, _group, credits_text
from .projects import get_project, project_dir
from .scenes import mmss

GROUP_TEXT = {"pexels": "Pexels", "pixabay": "Pixabay", "tercero": "Tercero", "propio": "Propio"}


class RightsRow(BaseModel):
    scene_position: int
    scene_start: str
    role: str
    file_name: str
    provider: str
    origin: str  # Pexels · Pixabay · Tercero · Propio
    author: str | None
    license: str | None
    source_url: str | None
    needs_review: bool


class RightsReport(BaseModel):
    project_id: int
    rows: list[RightsRow]
    review_count: int
    credits: str


def _needs_review(license: str | None, origin: str) -> bool:
    text = (license or "").lower()
    return origin == "tercero" and (not text or "revisar" in text)


def rights_report(session: Session, project_id: int) -> RightsReport:
    project = get_project(session, project_id)
    scenes = session.exec(
        select(Scene).where(Scene.project_id == project_id).order_by(col(Scene.position))
    ).all()
    approved = _approved_by_scene(session, project_id)
    rows = []
    for scene in scenes:
        for row, asset in approved.get(scene.id, []):
            origin = _group(asset)
            rows.append(
                RightsRow(
                    scene_position=scene.position,
                    scene_start=mmss(scene.start_s),
                    role="principal" if row.role == "main" else "alterno",
                    file_name=Path(row.file_path or asset.file_path).name,
                    provider=asset.provider,
                    origin=GROUP_TEXT[origin],
                    author=asset.author,
                    license=asset.license,
                    source_url=asset.source_page_url or asset.source_file_url,
                    needs_review=_needs_review(asset.license, origin),
                )
            )
    return RightsReport(
        project_id=project_id,
        rows=rows,
        review_count=sum(r.needs_review for r in rows),
        credits=credits_text(project.title, scenes, approved),
    )


def rights_csv(report: RightsReport) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(
        [
            "Escena",
            "Inicio",
            "Uso",
            "Archivo",
            "Origen",
            "Fuente",
            "Autor",
            "Licencia",
            "Dirección",
            "Revisar",
        ]
    )
    for r in report.rows:
        writer.writerow(
            [r.scene_position, r.scene_start, r.role, r.file_name, r.origin, r.provider,
             r.author or "", r.license or "", r.source_url or "", "sí" if r.needs_review else ""]
        )  # fmt: skip
    return out.getvalue()


def export_rights(session: Session, project_id: int) -> str:
    """Escribe derechos.csv (y creditos.txt) en la carpeta del proyecto; devuelve la ruta."""
    project = get_project(session, project_id)
    report = rights_report(session, project_id)
    folder = project_dir(project)
    (folder / "derechos.csv").write_text(rights_csv(report), encoding="utf-8-sig")
    (folder / "creditos.txt").write_text(report.credits, encoding="utf-8")
    return str(folder / "derechos.csv")
