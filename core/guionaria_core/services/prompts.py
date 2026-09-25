"""Prompts editables (sección 14): los originales van en el paquete y se copian a
config/prompts/ la primera vez. La app siempre lee la copia del usuario."""

import re
import sys
from pathlib import Path

from pydantic import BaseModel

from ..config import get_paths
from .errors import NotFound

PROMPTS: dict[str, str] = {
    "guion": "Generar guion",
    "reescribir_segmento": "Reescribir fragmento",
    "escenas": "Generar escenas",
    "busquedas_alternativas": "Sugerir búsquedas",
}


class PromptRead(BaseModel):
    name: str
    label: str
    content: str
    is_default: bool


def _defaults_dir() -> Path:
    # Con PyInstaller los datos se extraen en sys._MEIPASS.
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent.parent))
    return base / "guionaria_core" / "prompts"


def default_content(name: str) -> str:
    return (_defaults_dir() / f"{name}.md").read_text(encoding="utf-8")


def _user_file(name: str) -> Path:
    return get_paths().prompts_dir / f"{name}.md"


def _check(name: str) -> None:
    if name not in PROMPTS:
        raise NotFound(f"No existe el prompt '{name}'")


def ensure_prompts() -> None:
    get_paths().prompts_dir.mkdir(parents=True, exist_ok=True)
    for name in PROMPTS:
        target = _user_file(name)
        if not target.exists():
            target.write_text(default_content(name), encoding="utf-8")


def load_prompt(name: str) -> str:
    _check(name)
    path = _user_file(name)
    return path.read_text(encoding="utf-8") if path.exists() else default_content(name)


def read_prompt(name: str) -> PromptRead:
    content = load_prompt(name)
    return PromptRead(
        name=name,
        label=PROMPTS[name],
        content=content,
        is_default=content == default_content(name),
    )


def list_prompts() -> list[PromptRead]:
    return [read_prompt(name) for name in PROMPTS]


def save_prompt(name: str, content: str) -> PromptRead:
    _check(name)
    _user_file(name).write_text(content, encoding="utf-8")
    return read_prompt(name)


def reset_prompt(name: str) -> PromptRead:
    return save_prompt(name, default_content(name))


def render(template: str, **values: object) -> str:
    """Reemplaza {clave} solo para las claves conocidas; deja intacto cualquier otro {…}
    (por ejemplo, un ejemplo JSON que el usuario haya escrito en el prompt)."""

    def sub(match: re.Match[str]) -> str:
        key = match.group(1)
        return str(values[key]) if key in values else match.group(0)

    return re.sub(r"\{(\w+)\}", sub, template)
