"""Historial de operaciones (sección 5.15): qué se generó, descargó, aprobó o borró, quién lo
hizo (tú, Claude por MCP o el sistema) y en qué proyecto."""

import json
from typing import Any, Literal

from pydantic import BaseModel
from sqlmodel import Session, col, select

from ..models import OperationLog, Project, Scene

Actor = Literal["ui", "mcp", "system"]

STATUS_TEXT = {
    "TIMELINE_LISTO": "Para editar",
    "RENDERIZADO": "Renderizado",
    "PROGRAMADO": "Programado",
    "PUBLICADO": "Publicado",
}
SOURCE_TEXT = {"claude": "con Claude", "mcp": "desde Claude (MCP)", "manual": "a mano"}
MODE_TEXT = {"none": "tal cual", "crop": "recortado", "blur": "fondo desenfocado"}

# Entidades cuyo entity_id es el id del proyecto.
PROJECT_ENTITIES = {"project", "script", "scenes", "media", "voice", "timeline"}
# Grupos del filtro de la pantalla.
GROUPS = {
    "project": {"project"},
    "script": {"script"},
    "scenes": {"scenes"},
    "media": {"media", "asset", "scene"},
    "voice": {"voice"},
    "timeline": {"timeline"},
    "ideas": {"idea"},
    "channels": {"channel"},
}


class HistoryItem(BaseModel):
    id: int
    at: str
    actor: Actor
    action: str
    entity: str
    text: str
    project_id: int | None
    project_title: str | None
    can_restore: bool  # borrado de proyecto que sigue en la papelera


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    next_before: int | None  # para pedir los anteriores


def describe(entity: str, action: str, d: dict[str, Any], scene_position: int | None) -> str:
    """Frase en español de una operación (sin sujeto: quién la hizo se muestra aparte)."""

    def n(key: str) -> Any:
        return d.get(key, "?")

    in_scene = f" en la escena {scene_position}" if scene_position else ""
    of_scene = f" (escena {scene_position})" if scene_position else ""
    fmt = "video 16:9" if d.get("format") == "video" else "reel 9:16"
    status = STATUS_TEXT.get(d.get("to", ""), d.get("to"))
    source = SOURCE_TEXT.get(d.get("source", ""), "")
    source = f" {source}" if source else ""
    mode = MODE_TEXT.get(d.get("mode", ""), d.get("mode"))
    alt = "como alterno " if d.get("role") == "alt" else ""
    voice = d.get("voice") or "voz del canal"
    formats = ", ".join(d.get("formats", []))
    texts: dict[tuple[str, str], str] = {
        ("project", "create"): f"Proyecto creado ({fmt})",
        ("project", "update"): "Datos del proyecto editados",
        ("project", "delete"): "Proyecto enviado a la papelera",
        ("project", "restore"): "Proyecto restaurado desde la papelera",
        ("project", "purge"): "Proyecto borrado definitivamente",
        ("project", "status"): f"Movido a «{status}»",
        ("project", "rename"): f"{n('files')} archivos aprobados renombrados",
        ("project", "cleanup"): f"{n('deleted')} candidatos sin usar borrados",
        ("script", "save"): f"Guion guardado{source} (versión {n('version')})",
        ("script", "approve"): f"Guion aprobado (versión {n('version')})",
        ("script", "unlock"): "Guion desbloqueado para editarlo",
        ("scenes", "generate"): f"Escenas generadas con Claude ({n('created')} nuevas)",
        ("scenes", "save"): f"Tabla de escenas guardada ({n('created')} escenas)",
        ("scenes", "approve"): f"Escenas aprobadas ({n('scenes')})",
        ("scenes", "unlock"): "Escenas desbloqueadas",
        ("media", "approve"): "Medios aprobados",
        ("media", "unlock"): "Medios desbloqueados",
        ("scene", "download"): f"Descarga de medios: {n('ok')} de {n('requested')}{of_scene}",
        ("asset", "approve"): f"Medio aprobado {alt}{in_scene}".replace("  ", " ").strip(),
        ("asset", "frame"): f"Encuadre del medio: {mode}{of_scene}",
        ("asset", "render"): "Video encuadrado generado con FFmpeg",
        ("asset", "reuse"): f"Medio reutilizado de la biblioteca{in_scene}",
        ("voice", "generate"): f"Voz generada con Piper ({voice})",
        ("voice", "upload"): f"Voz grabada subida ({n('file')})",
        ("voice", "transcribe"): f"Voz transcrita con Whisper ({n('words')} palabras)",
        ("timeline", "export"): f"Timeline exportado ({formats})",
        ("idea", "create"): f"Idea guardada: «{n('title')}»",
        ("idea", "delete"): f"Idea eliminada: «{n('title')}»",
        ("idea", "convert"): "Idea convertida en proyecto",
        ("channel", "create"): f"Canal creado: «{n('name')}»",
        ("channel", "update"): "Canal editado",
        ("channel", "delete"): f"Canal eliminado: «{n('name')}»",
    }
    return texts.get((entity, action), f"{action} · {entity}")


def list_history(
    session: Session,
    *,
    actor: Actor | None = None,
    group: str | None = None,
    project_id: int | None = None,
    before: int | None = None,
    limit: int = 100,
) -> HistoryPage:
    stmt = select(OperationLog).order_by(col(OperationLog.id).desc())
    if actor:
        stmt = stmt.where(OperationLog.actor == actor)
    if group in GROUPS:
        stmt = stmt.where(col(OperationLog.entity).in_(GROUPS[group]))
    if before:
        stmt = stmt.where(OperationLog.id < before)
    # El filtro por proyecto se resuelve en Python (medios y descargas se ligan por la escena).
    rows = session.exec(stmt.limit(limit * 5 if project_id else limit + 1)).all()

    projects = {p.id: p for p in session.exec(select(Project)).all()}
    scenes = {s.id: s for s in session.exec(select(Scene)).all()}
    items: list[HistoryItem] = []
    for op in rows:
        d = json.loads(op.details) if op.details else {}
        scene = None
        if op.entity == "scene":
            scene = scenes.get(op.entity_id)
        elif op.entity == "asset" and d.get("scene"):
            scene = scenes.get(d["scene"])
        pid = (
            op.entity_id
            if op.entity in PROJECT_ENTITIES
            else scene.project_id
            if scene
            else d.get("project")
        )
        if project_id and pid != project_id:
            continue
        project = projects.get(pid) if pid else None
        items.append(
            HistoryItem(
                id=op.id,
                at=op.at,
                actor=op.actor if op.actor in ("ui", "mcp", "system") else "ui",
                action=op.action or "",
                entity=op.entity or "",
                text=describe(
                    op.entity or "", op.action or "", d, scene.position if scene else None
                ),
                project_id=pid,
                project_title=project.title
                if project
                else d.get("title")
                if op.entity == "project"
                else None,
                can_restore=bool(
                    op.entity == "project"
                    and op.action == "delete"
                    and project
                    and project.deleted_at
                ),
            )
        )
        if len(items) > limit:
            break
    more = len(items) > limit
    items = items[:limit]
    return HistoryPage(items=items, next_before=items[-1].id if more and items else None)
