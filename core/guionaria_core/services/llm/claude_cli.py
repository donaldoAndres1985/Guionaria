"""Claude dentro de la app: Claude Code CLI en modo headless (sección 4.1 de SPEC.md).

Se ejecuta `claude -p` con salida estructurada (--json-schema), sin herramientas (solo escribe
texto) y sin guardar la sesión en el historial del usuario. El prompt va por stdin porque
Windows limita el largo de la línea de comandos y las notas de investigación pueden ser largas.
"""

import asyncio
import json
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from ...config import load_settings
from ..errors import DomainError

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
DEFAULT_TIMEOUT_S = 300


class ClaudeError(DomainError):
    status_code = 502


class ClaudeRunner(Protocol):
    async def run(self, prompt: str, schema: dict[str, Any], cwd: Path | None = None) -> Any: ...


def _friendly_error(text: str) -> str:
    low = text.lower()
    if any(k in low for k in ("usage limit", "rate limit", "limit reached", "quota")):
        return "Se alcanzó el límite de uso de tu plan de Claude. Intenta de nuevo más tarde."
    if any(k in low for k in ("login", "log in", "not authenticated", "unauthorized", "api key")):
        return (
            "Claude Code no tiene una sesión iniciada. Abre una terminal, ejecuta `claude` "
            "e inicia sesión con tu cuenta."
        )
    return f"Claude devolvió un error: {text.strip()[:300]}"


class ClaudeCli:
    def __init__(self, model: str = "", timeout_s: int = DEFAULT_TIMEOUT_S):
        self.model = model
        self.timeout_s = timeout_s

    def build_args(self, exe: str, schema: dict[str, Any]) -> list[str]:
        args = [
            exe,
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(schema, ensure_ascii=False),
            "--tools",
            "",
            "--no-session-persistence",
        ]
        if self.model:
            args += ["--model", self.model]
        return args

    async def run(self, prompt: str, schema: dict[str, Any], cwd: Path | None = None) -> Any:
        exe = shutil.which("claude")
        if not exe:
            raise ClaudeError(
                "No se encontró Claude Code CLI. Instálalo y revisa Ajustes → Dependencias."
            )
        try:
            proc = await asyncio.to_thread(
                subprocess.run,
                self.build_args(exe, schema),
                input=prompt.encode("utf-8"),
                capture_output=True,
                timeout=self.timeout_s,
                cwd=str(cwd) if cwd else None,
                creationflags=_NO_WINDOW,
            )
        except subprocess.TimeoutExpired as exc:
            raise ClaudeError(
                f"Claude no respondió en {self.timeout_s // 60} minutos. Intenta de nuevo."
            ) from exc
        except OSError as exc:
            raise ClaudeError(f"No se pudo ejecutar Claude Code CLI: {exc}") from exc
        return parse_output(proc.stdout, proc.stderr, proc.returncode)


def parse_output(stdout: bytes, stderr: bytes, returncode: int) -> Any:
    out = stdout.decode("utf-8", errors="replace").strip()
    err = stderr.decode("utf-8", errors="replace").strip()
    try:
        data = json.loads(out)
    except json.JSONDecodeError as exc:
        raise ClaudeError(_friendly_error(err or out or f"código de salida {returncode}")) from exc

    if data.get("is_error") or data.get("subtype") != "success":
        raise ClaudeError(_friendly_error(str(data.get("result") or data.get("subtype") or err)))
    if data.get("structured_output") is not None:
        return data["structured_output"]
    try:
        return json.loads(data.get("result") or "")
    except json.JSONDecodeError as exc:
        raise ClaudeError("Claude respondió, pero no en el formato JSON esperado.") from exc


def _default_runner() -> ClaudeRunner:
    return ClaudeCli(model=load_settings().claude_model)


# Los tests reemplazan la fábrica para no llamar a la CLI real.
runner_factory: Callable[[], ClaudeRunner] = _default_runner


def get_runner() -> ClaudeRunner:
    return runner_factory()


async def generate_structured[T: BaseModel](
    runner: ClaudeRunner,
    prompt: str,
    model: type[T],
    cwd: Path | None = None,
    check: Callable[[T], None] | None = None,
) -> T:
    """Pide a Claude una respuesta con el esquema de `model` y la valida.

    Si no valida (esquema o regla de `check`), reintenta una vez adjuntando el error.
    """
    schema = model.model_json_schema()
    attempt_prompt = prompt
    last_error = ""
    for _ in range(2):
        raw = await runner.run(attempt_prompt, schema, cwd)
        try:
            value = model.model_validate(raw)
            if check:
                check(value)
            return value
        except (ValidationError, ValueError) as exc:
            last_error = str(exc)
            attempt_prompt = (
                f"{prompt}\n\nTu respuesta anterior no fue válida:\n{last_error[:1500]}\n"
                "Corrígela y responde de nuevo con el formato pedido."
            )
    raise ClaudeError(f"Claude respondió dos veces con un formato no válido: {last_error[:300]}")
