"""Cómo conectar Claude con Guionaria por MCP (sección 4.2): datos para Ajustes y registro
automático en Claude Code con `claude mcp add`."""

import json
import shutil
import subprocess
import sys
from collections.abc import Callable

from pydantic import BaseModel

from .errors import DomainError

SERVER_NAME = "guionaria"
HTTP_URL = "http://127.0.0.1:8765/mcp"
ADD_ARGS = ["mcp", "add", "--transport", "http", "--scope", "user", SERVER_NAME, HTTP_URL]
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


class McpInfo(BaseModel):
    http_url: str
    claude_code_command: str
    desktop_config: str  # bloque para claude_desktop_config.json
    claude_code_available: bool
    claude_code_registered: bool | None  # None: no se pudo consultar


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8", timeout=30, creationflags=_NO_WINDOW
    )


# Los tests reemplazan la ejecución de la CLI.
runner: Callable[[list[str]], subprocess.CompletedProcess] = _run


def stdio_command() -> tuple[str, list[str]]:
    """El ejecutable del núcleo instalado (sidecar) o, en desarrollo, el Python del entorno."""
    if getattr(sys, "frozen", False):
        return sys.executable, ["mcp"]
    return sys.executable, ["-m", "guionaria_core", "mcp"]


def desktop_config() -> str:
    command, args = stdio_command()
    block = {"mcpServers": {SERVER_NAME: {"command": command, "args": args}}}
    return json.dumps(block, indent=2, ensure_ascii=False)


def _registered(exe: str) -> bool | None:
    try:
        return runner([exe, "mcp", "get", SERVER_NAME]).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return None


def mcp_info() -> McpInfo:
    exe = shutil.which("claude")
    return McpInfo(
        http_url=HTTP_URL,
        claude_code_command=" ".join(["claude", *ADD_ARGS]),
        desktop_config=desktop_config(),
        claude_code_available=exe is not None,
        claude_code_registered=_registered(exe) if exe else None,
    )


def register_claude_code() -> McpInfo:
    """Registra el servidor HTTP para el usuario (todos los proyectos de Claude Code)."""
    exe = shutil.which("claude")
    if not exe:
        raise DomainError("No se encontró Claude Code CLI. Revisa Ajustes → Dependencias.")
    if _registered(exe):
        return mcp_info()
    args = [exe, *ADD_ARGS]
    try:
        proc = runner(args)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DomainError(f"No se pudo ejecutar Claude Code CLI: {exc}") from exc
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        raise DomainError(
            "Claude Code no pudo registrar el servidor" + (f": {detail[-1]}" if detail else "")
        )
    return mcp_info()
