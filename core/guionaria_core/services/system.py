"""Acciones del sistema operativo: abrir en el navegador y mostrar en la carpeta.

Las hace el núcleo (que corre en el equipo del usuario) para que funcionen igual en la app y
en el navegador de desarrollo. Los tests reemplazan `open_browser` y `launch`.
"""

import subprocess
import sys
import webbrowser
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlparse

from .errors import DomainError, NotFound

open_browser: Callable[[str], object] = webbrowser.open
launch: Callable[[list[str]], object] = lambda args: subprocess.Popen(args)  # noqa: E731


def open_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise DomainError("Solo se pueden abrir direcciones http o https")
    open_browser(url)


def reveal(path: Path) -> None:
    """Abre la carpeta con el archivo seleccionado (o la carpeta, si es una carpeta)."""
    if not path.exists():
        raise NotFound("El archivo no está en disco")
    if sys.platform == "win32":
        launch(["explorer", f"/select,{path}"] if path.is_file() else ["explorer", str(path)])
    elif sys.platform == "darwin":
        launch(["open", "-R", str(path)] if path.is_file() else ["open", str(path)])
    else:
        launch(["xdg-open", str(path.parent if path.is_file() else path)])
