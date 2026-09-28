"""«Investigar con fuentes»: Claude busca en internet (WebSearch/WebFetch) y devuelve una ficha
verificada con fuentes para una idea o un proyecto.

Dónde queda:
- La ficha completa (JSON) en `research_json` de la idea o del proyecto: la app la muestra con
  la certeza de cada dato y los enlaces.
- Una versión legible con citas [1], [2]… en las notas de investigación: es lo que Claude usa
  como fuente al escribir el guion. Las notas que había antes se conservan debajo.
- En los proyectos, además, `investigacion.md` en la carpeta del proyecto.
"""

import json
from datetime import date

from pydantic import BaseModel
from sqlmodel import Session

from ..config import load_settings
from ..models import Idea, Project
from ..models._base import now_iso
from ..schemas.research import InvestigacionClaude, ResearchRead
from . import prompts
from .channels import get_channel
from .errors import DomainError
from .jobs import JobContext
from .llm.claude_cli import ClaudeRunner, generate_structured
from .oplog import log_operation
from .projects import get_project, project_dir

WEB_TOOLS = ["WebSearch", "WebFetch"]
RESEARCH_HEADER = "## Investigación con fuentes"
ORIGINAL_HEADER = "## Notas anteriores"
FILE_NAME = "investigacion.md"
CERTEZA = {"confirmado": "✔", "una_fuente": "◐ una sola fuente", "en_disputa": "⚠ en disputa"}


class ResearchResult(BaseModel):
    target: str  # idea | project
    target_id: int
    datos: int
    fuentes: int
    en_disputa: int


def _check(value: InvestigacionClaude) -> None:
    ids = {f.id for f in value.fuentes}
    missing = sorted({i for d in value.datos for i in d.fuentes} - ids)
    if missing:
        raise ValueError(f"Hay datos que citan fuentes inexistentes: {missing}")
    if any(not f.url.startswith(("http://", "https://")) for f in value.fuentes):
        raise ValueError("Cada fuente necesita la URL exacta que se consultó (http o https)")


def stats(dossier: InvestigacionClaude) -> dict[str, int]:
    count = {k: 0 for k in CERTEZA}
    for d in dossier.datos:
        count[d.certeza] += 1
    return {**count, "fuentes": len(dossier.fuentes)}


def render_markdown(dossier: InvestigacionClaude, when: str) -> str:
    """Versión legible de la ficha, con citas: va a las notas y a investigacion.md."""
    cite = lambda ids: "".join(f"[{i}]" for i in ids)  # noqa: E731
    lines = [f"{RESEARCH_HEADER} ({when[:10]})", "", dossier.resumen, "", "### Datos verificados"]
    for d in dossier.datos:
        mark = CERTEZA[d.certeza]
        extra = f" — {d.nota}" if d.nota else ""
        lines.append(f"- {mark} {d.afirmacion} {cite(d.fuentes)}{extra}")
    for title, items in (
        ("Contradicciones entre fuentes", dossier.contradicciones),
        ("Sin verificar o sin resolver", dossier.incognitas),
        ("Cuidados al contarlo", dossier.cuidados),
        ("Ganchos posibles", dossier.ganchos),
    ):
        if items:
            lines += ["", f"### {title}", *[f"- {x}" for x in items]]
    lines += ["", "### Fuentes"]
    for f in dossier.fuentes:
        meta = ", ".join(x for x in (f.medio, f.fecha) if x)
        lines.append(f"[{f.id}] {f.titulo}{f' — {meta}' if meta else ''}. {f.url}")
    return "\n".join(lines)


def _base_notes(notes: str | None, research_json: str | None) -> str:
    """Las notas escritas por la persona, sin la investigación anterior (para no anidarla)."""
    if research_json:
        saved = json.loads(research_json).get("original_notes")
        if saved is not None:
            return saved
    return (notes or "").strip()


def _merged_notes(markdown: str, original: str) -> str:
    return f"{markdown}\n\n{ORIGINAL_HEADER}\n{original}" if original else markdown


def _prompt(channel, title: str, notes: str) -> str:
    settings = load_settings()
    n = settings.research_max_searches
    return prompts.render(
        prompts.load_prompt("investigacion"),
        canal=channel.name,
        estilo=channel.style_prompt or "Claro y directo.",
        idioma=channel.language,
        fecha=date.today().isoformat(),
        titulo=title,
        notas=notes or "(sin notas previas)",
        max_busquedas=n,
        max_paginas=n * 2,
    )


def read_research(research_json: str | None) -> ResearchRead | None:
    if not research_json:
        return None
    data = json.loads(research_json)
    dossier = InvestigacionClaude.model_validate(data["dossier"])
    return ResearchRead(created_at=data["created_at"], dossier=dossier, stats=stats(dossier))


def _payload(dossier: InvestigacionClaude, original: str) -> str:
    return json.dumps(
        {"created_at": now_iso(), "dossier": dossier.model_dump(), "original_notes": original},
        ensure_ascii=False,
    )


def write_file(project: Project, research_json: str | None) -> None:
    research = read_research(research_json)
    if research:
        folder = project_dir(project)
        folder.mkdir(parents=True, exist_ok=True)
        md = f"# {project.title}\n\n{render_markdown(research.dossier, research.created_at)}\n"
        (folder / FILE_NAME).write_text(md, encoding="utf-8")


async def research_idea(session_factory, idea_id: int, runner: ClaudeRunner, ctx: JobContext):
    with session_factory() as session:
        idea = session.get(Idea, idea_id)
        if not idea:
            raise DomainError("La idea no existe")
        channel = get_channel(session, idea.channel_id)
        original = _base_notes(idea.notes, idea.research_json)
        prompt = _prompt(channel, idea.title or "", original)
    ctx.progress(0.1, "Claude está buscando fuentes en internet…")
    dossier = await generate_structured(
        runner, prompt, InvestigacionClaude, check=_check, tools=WEB_TOOLS
    )
    with session_factory() as session:
        idea = session.get(Idea, idea_id)
        idea.research_json = _payload(dossier, original)
        idea.notes = _merged_notes(render_markdown(dossier, now_iso()), original)
        idea.updated_at = now_iso()
        log_operation(session, "research", "idea", idea_id, stats(dossier), actor="system")
        session.commit()
    return _result("idea", idea_id, dossier)


async def research_project(session_factory, project_id: int, runner: ClaudeRunner, ctx: JobContext):
    with session_factory() as session:
        project = get_project(session, project_id)
        channel = get_channel(session, project.channel_id)
        original = _base_notes(project.research_notes, project.research_json)
        topic = project.topic or project.title
        title = topic if topic == project.title else f"{project.title}. {topic}"
        prompt = _prompt(channel, title, original)
    ctx.progress(0.1, "Claude está buscando fuentes en internet…")
    dossier = await generate_structured(
        runner, prompt, InvestigacionClaude, check=_check, tools=WEB_TOOLS
    )
    with session_factory() as session:
        project = get_project(session, project_id)
        project.research_json = _payload(dossier, original)
        project.research_notes = _merged_notes(render_markdown(dossier, now_iso()), original)
        project.updated_at = now_iso()
        write_file(project, project.research_json)
        log_operation(session, "research", "project", project_id, stats(dossier), actor="system")
        session.commit()
    return _result("project", project_id, dossier)


def _result(target: str, target_id: int, dossier: InvestigacionClaude) -> dict:
    s = stats(dossier)
    return ResearchResult(
        target=target,
        target_id=target_id,
        datos=len(dossier.datos),
        fuentes=s["fuentes"],
        en_disputa=s["en_disputa"],
    ).model_dump()


def copy_to_project(session: Session, idea: Idea, project: Project) -> None:
    """Al convertir una idea, su ficha pasa al proyecto (y se escribe investigacion.md)."""
    if idea.research_json:
        project.research_json = idea.research_json
        write_file(project, project.research_json)
