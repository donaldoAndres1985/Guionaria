"""Verificación de herramientas externas (sección 5.16 de SPEC.md)."""

import asyncio
import shutil
import time
from dataclasses import dataclass

import httpx
from pydantic import BaseModel

from ..config import load_settings

_CACHE_TTL_S = 30.0
_cache: tuple[float, list["DependencyStatus"]] | None = None


class DependencyStatus(BaseModel):
    name: str
    label: str
    ok: bool
    required: bool
    version: str | None = None
    path: str | None = None
    detail: str | None = None
    install_hint: str


@dataclass(frozen=True)
class _Tool:
    name: str
    label: str
    args: tuple[str, ...]
    required: bool
    install_hint: str


_TOOLS = (
    _Tool("ffmpeg", "FFmpeg", ("-version",), True, "winget install Gyan.FFmpeg"),
    _Tool("ffprobe", "FFprobe", ("-version",), True, "Se instala junto con FFmpeg"),
    _Tool("yt-dlp", "yt-dlp", ("--version",), False, "winget install yt-dlp.yt-dlp"),
    _Tool(
        "claude",
        "Claude Code CLI",
        ("--version",),
        True,
        "Ver instrucciones vigentes en docs.claude.com (Claude Code)",
    ),
    _Tool("docker", "Docker", ("--version",), False, "winget install Docker.DockerDesktop"),
)


async def _check_tool(tool: _Tool) -> DependencyStatus:
    status = DependencyStatus(
        name=tool.name,
        label=tool.label,
        ok=False,
        required=tool.required,
        install_hint=tool.install_hint,
    )
    path = shutil.which(tool.name)
    if not path:
        status.detail = "No encontrado en el PATH"
        return status
    status.path = path
    try:
        proc = await asyncio.create_subprocess_exec(
            path,
            *tool.args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
    except (OSError, TimeoutError) as exc:
        status.detail = f"No se pudo ejecutar: {exc}"
        return status
    first_line = out.decode("utf-8", errors="replace").strip().splitlines()[:1]
    status.version = first_line[0] if first_line else None
    status.ok = proc.returncode == 0
    if not status.ok:
        status.detail = f"Terminó con código {proc.returncode}"
    return status


async def _check_searxng(base_url: str) -> DependencyStatus:
    status = DependencyStatus(
        name="searxng",
        label="SearXNG",
        ok=False,
        required=False,
        path=base_url,
        install_hint=(
            "docker run -d --name searxng -p 8888:8080 -v searxng:/etc/searxng searxng/searxng"
            " (y activar formato json en settings.yml)"
        ),
    )
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(
                f"{base_url.rstrip('/')}/search", params={"q": "test", "format": "json"}
            )
    except httpx.HTTPError:
        status.detail = "No responde"
        return status
    if resp.status_code == 403:
        status.detail = "Responde, pero el formato json no está activado"
    elif resp.is_success:
        status.ok = True
    else:
        status.detail = f"HTTP {resp.status_code}"
    return status


async def check_dependencies(refresh: bool = False) -> list[DependencyStatus]:
    global _cache
    if not refresh and _cache and time.monotonic() - _cache[0] < _CACHE_TTL_S:
        return _cache[1]
    settings = load_settings()
    results = await asyncio.gather(
        *(_check_tool(t) for t in _TOOLS), _check_searxng(settings.searxng_url)
    )
    _cache = (time.monotonic(), list(results))
    return _cache[1]
