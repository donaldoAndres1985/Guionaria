"""Transiciones entre escenas (xfade de FFmpeg).

Cada corte puede tener la suya o usar la de por defecto (Ajustes del timeline). Para que la
voz no se desfase, la escena que sale se renderiza con una «cola» del largo de la
transición y la siguiente empieza a fundirse justo en su inicio: el video dura lo mismo que
sin transiciones.
"""

from dataclasses import dataclass

from ...config import TransitionPrefs

# id de xfade → nombre en la app. El orden es el del selector.
TRANSITIONS: dict[str, str] = {
    "fade": "Fundido cruzado",
    "fadeblack": "Fundido a negro",
    "fadewhite": "Destello blanco",
    "fadegrays": "Fundido en gris",
    "dissolve": "Disolver",
    "slideleft": "Empujar a la izquierda",
    "slideright": "Empujar a la derecha",
    "slideup": "Empujar hacia arriba",
    "slidedown": "Empujar hacia abajo",
    "wipeleft": "Barrido a la izquierda",
    "wiperight": "Barrido a la derecha",
    "wipeup": "Barrido hacia arriba",
    "wipedown": "Barrido hacia abajo",
    "smoothleft": "Barrido suave",
    "circleopen": "Círculo que se abre",
    "circleclose": "Círculo que se cierra",
    "horzopen": "Puertas",
    "radial": "Reloj",
    "zoomin": "Acercar",
    "hblur": "Desenfoque",
    "pixelize": "Pixelado",
}
NONE = "none"  # corte directo
MIN_S = 0.1
MAX_SHARE = 0.45  # como mucho, este tanto de la escena más corta del corte


@dataclass
class Cut:
    """Corte entre la escena `index` y la siguiente."""

    index: int
    transition: str | None  # None: corte directo
    duration: float  # segundos (0 en un corte directo)


def resolve(
    chosen: list[str | None],
    durations: list[float],
    prefs: TransitionPrefs,
    lengths: list[float | None] | None = None,
) -> list[Cut]:
    """Transición de cada corte: la elegida en la escena que sale o la de por defecto, con
    su duración propia (`lengths`) o la de por defecto. Se acorta si las escenas son muy
    cortas; si no cabe, queda como corte directo."""
    cuts = []
    for i in range(len(durations) - 1):
        kind = chosen[i] or prefs.default
        room = MAX_SHARE * min(durations[i], durations[i + 1])
        wanted = (lengths[i] if lengths and lengths[i] else None) or prefs.duration
        seconds = round(min(wanted, room), 3)
        if kind == NONE or kind not in TRANSITIONS or seconds < MIN_S:
            cuts.append(Cut(i, None, 0.0))
        else:
            cuts.append(Cut(i, kind, seconds))
    return cuts
