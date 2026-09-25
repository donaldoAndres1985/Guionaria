"""Máquina de estados del proyecto (sección 2 de SPEC.md)."""

from enum import StrEnum


class ProjectStatus(StrEnum):
    IDEA = "IDEA"
    GUION_BORRADOR = "GUION_BORRADOR"
    GUION_APROBADO = "GUION_APROBADO"
    ESCENAS_BORRADOR = "ESCENAS_BORRADOR"
    ESCENAS_APROBADAS = "ESCENAS_APROBADAS"
    MEDIOS_EN_REVISION = "MEDIOS_EN_REVISION"
    MEDIOS_APROBADOS = "MEDIOS_APROBADOS"
    VOZ_LISTA = "VOZ_LISTA"
    TIMELINE_LISTO = "TIMELINE_LISTO"
    RENDERIZADO = "RENDERIZADO"
    PROGRAMADO = "PROGRAMADO"
    PUBLICADO = "PUBLICADO"


ORDER: list[ProjectStatus] = list(ProjectStatus)


def can_transition(current: ProjectStatus, target: ProjectStatus) -> bool:
    """Se avanza de a un paso; retroceder a cualquier estado anterior está permitido
    (desbloquear guion o escenas aplica la regla de propagación)."""
    i, j = ORDER.index(current), ORDER.index(target)
    return j == i + 1 or j < i
