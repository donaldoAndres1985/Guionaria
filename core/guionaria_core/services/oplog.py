"""Historial de operaciones (sección 5.15). Se escribe en la misma transacción que el cambio."""

import json
from contextvars import ContextVar
from typing import Any

from sqlmodel import Session

from ..models import OperationLog

# Quién hace el cambio cuando el servicio no lo indica: la UI por defecto; las herramientas MCP
# lo cambian a "mcp" mientras se ejecutan.
current_actor: ContextVar[str] = ContextVar("current_actor", default="ui")


def log_operation(
    session: Session,
    action: str,
    entity: str,
    entity_id: int | None,
    details: dict[str, Any] | None = None,
    actor: str | None = None,
) -> None:
    session.add(
        OperationLog(
            actor=actor or current_actor.get(),
            action=action,
            entity=entity,
            entity_id=entity_id,
            details=json.dumps(details, ensure_ascii=False) if details else None,
        )
    )
