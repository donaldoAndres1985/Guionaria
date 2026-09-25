"""Historial de operaciones (sección 5.15). Se escribe en la misma transacción que el cambio."""

import json
from typing import Any

from sqlmodel import Session

from ..models import OperationLog


def log_operation(
    session: Session,
    action: str,
    entity: str,
    entity_id: int | None,
    details: dict[str, Any] | None = None,
    actor: str = "ui",
) -> None:
    session.add(
        OperationLog(
            actor=actor,
            action=action,
            entity=entity,
            entity_id=entity_id,
            details=json.dumps(details, ensure_ascii=False) if details else None,
        )
    )
