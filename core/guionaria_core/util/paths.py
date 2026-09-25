import sys
from functools import lru_cache
from pathlib import Path

WINDOWS_MAX_PATH = 259  # 260 incluido el terminador


@lru_cache
def long_paths_enabled() -> bool:
    if sys.platform != "win32":
        return True
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem"
        ) as key:
            return winreg.QueryValueEx(key, "LongPathsEnabled")[0] == 1
    except OSError:
        return False


def check_path_length(path: Path) -> None:
    """Windows sin rutas largas no puede escribir rutas de más de 259 caracteres: se avisa con la
    solución en vez de fallar con "no se encuentra la ruta"."""
    from ..services.errors import DomainError

    if len(str(path)) > WINDOWS_MAX_PATH and not long_paths_enabled():
        raise DomainError(
            f"La ruta del archivo tiene {len(str(path))} caracteres y Windows admite 259. "
            "Usa una carpeta de datos más corta (GUIONARIA_HOME) o activa las rutas largas "
            "de Windows (LongPathsEnabled)."
        )
