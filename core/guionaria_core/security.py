# Orígenes del webview de Tauri (Windows usa http://tauri.localhost) y del dev server de Vite.
ALLOWED_ORIGINS = [
    "http://localhost:1420",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
]


def origin_allowed(origin: str | None) -> bool:
    """Los WebSocket no pasan por CORS: sin esta comprobación cualquier página abierta en el
    navegador podría conectarse. Sin cabecera Origin = cliente que no es navegador (permitido)."""
    return origin is None or origin in ALLOWED_ORIGINS
