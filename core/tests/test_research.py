"""«Investigar con fuentes»: ficha con citas en ideas y proyectos (Claude simulado)."""

from guionaria_core.services.llm.claude_cli import ClaudeCli
from tests.conftest import wait_job

FICHA = {
    "resumen": "El 13 de enero de 2006 una banda robó el Banco Río de Acassuso sin herir a nadie.",
    "datos": [
        {
            "afirmacion": "Ocurrió el 13 de enero de 2006.",
            "certeza": "confirmado",
            "fuentes": [1, 2],
        },
        {"afirmacion": "Retuvieron a unas 23 personas.", "certeza": "una_fuente", "fuentes": [1]},
        {
            "afirmacion": "El botín superó los 8 millones de dólares.",
            "certeza": "en_disputa",
            "fuentes": [1, 2],
            "nota": "Las cifras van de 8 a 19 millones según el medio.",
        },
    ],
    "fuentes": [
        {"id": 1, "titulo": "El robo del siglo", "medio": "La Nación", "url": "https://www.lanacion.com.ar/x",
         "fecha": "2006-01-14", "tipo": "prensa"},
        {"id": 2, "titulo": "Sentencia", "medio": "Poder Judicial", "url": "https://www.cij.gov.ar/y",
         "fecha": None, "tipo": "judicial"},
    ],
    "contradicciones": ["El monto del botín varía entre medios."],
    "incognitas": ["Nunca se recuperó todo el dinero."],
    "cuidados": ["No mencionar a los rehenes por su nombre."],
    "ganchos": ["Robaron un banco sin disparar un solo tiro."],
}  # fmt: skip


def make_idea(client, channel, notes="Notas mías: dicen que fueron 8 millones."):
    return client.post(
        "/api/ideas",
        json={"channel_id": channel["id"], "title": "Robo de Acassuso", "notes": notes},
    ).json()


def research(client, url):
    resp = client.post(url)
    assert resp.status_code == 202, resp.text
    return wait_job(client, resp.json()["id"])


def test_research_an_idea_with_web_tools(client, fake_claude, channel):
    idea = make_idea(client, channel)
    fake_claude.queue(FICHA)
    job = research(client, f"/api/ideas/{idea['id']}:research")
    assert job["status"] == "done", job["error"]
    assert job["result"] == {"target": "idea", "target_id": idea["id"], "datos": 3, "fuentes": 2,
                             "en_disputa": 1}  # fmt: skip

    call = fake_claude.calls[0]
    assert call["tools"] == ["WebSearch", "WebFetch"]  # solo en esta llamada
    assert "como máximo 6 búsquedas" in call["prompt"]
    assert "Notas mías" in call["prompt"]  # las notas previas se verifican

    data = client.get("/api/ideas").json()[0]
    assert data["research"]["stats"] == {"confirmado": 1, "una_fuente": 1, "en_disputa": 1,
                                         "fuentes": 2}  # fmt: skip
    notes = data["notes"]
    assert notes.startswith("## Investigación con fuentes")
    assert "- ✔ Ocurrió el 13 de enero de 2006. [1][2]" in notes
    assert "⚠ en disputa El botín superó" in notes
    assert "[2] Sentencia — Poder Judicial. https://www.cij.gov.ar/y" in notes
    assert notes.endswith("## Notas anteriores\nNotas mías: dicen que fueron 8 millones.")


def test_research_again_does_not_nest(client, fake_claude, channel):
    idea = make_idea(client, channel)
    fake_claude.queue(FICHA, FICHA)
    research(client, f"/api/ideas/{idea['id']}:research")
    research(client, f"/api/ideas/{idea['id']}:research")
    notes = client.get("/api/ideas").json()[0]["notes"]
    assert notes.count("## Investigación con fuentes") == 1
    assert notes.count("## Notas anteriores") == 1
    # La segunda vez se verifican las notas de la persona, no la ficha anterior.
    assert "## Investigación" not in fake_claude.calls[1]["prompt"]


def test_invalid_citations_are_retried(client, fake_claude, channel):
    idea = make_idea(client, channel)
    bad = {**FICHA, "datos": [{**FICHA["datos"][0], "fuentes": [9]}, *FICHA["datos"][1:]]}
    fake_claude.queue(bad, FICHA)
    job = research(client, f"/api/ideas/{idea['id']}:research")
    assert job["status"] == "done"
    assert "fuentes inexistentes" in fake_claude.calls[1]["prompt"]


def test_convert_passes_research_to_the_project(client, fake_claude, channel, home):
    idea = make_idea(client, channel)
    fake_claude.queue(FICHA)
    research(client, f"/api/ideas/{idea['id']}:research")
    project = client.post(f"/api/ideas/{idea['id']}:convert", json={"format": "reel"}).json()
    assert project["research"]["stats"]["fuentes"] == 2
    assert project["research_notes"].startswith("## Investigación con fuentes")
    [folder] = (home / "channels" / channel["slug"] / "projects").iterdir()
    md = (folder / "investigacion.md").read_text(encoding="utf-8")
    assert md.startswith("# Robo de Acassuso")
    assert "### Fuentes" in md


def test_research_a_project(client, fake_claude, project, home):
    fake_claude.queue(FICHA)
    job = research(client, f"/api/projects/{project['id']}/research")
    assert job["status"] == "done", job["error"]
    data = client.get(f"/api/projects/{project['id']}").json()
    assert data["research"]["dossier"]["ganchos"] == ["Robaron un banco sin disparar un solo tiro."]
    assert data["research_notes"].endswith("## Notas anteriores\nOcurrió en 2008 en CDMX.")
    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    assert (folder / "investigacion.md").exists()


def test_research_failure_is_reported(client, fake_claude, channel):
    from guionaria_core.services.llm.claude_cli import ClaudeError

    idea = make_idea(client, channel)
    fake_claude.queue(ClaudeError("Se alcanzó el límite de uso de tu plan de Claude."))
    job = research(client, f"/api/ideas/{idea['id']}:research")
    assert job["status"] == "failed"
    assert "límite de uso" in job["error"]
    assert client.get("/api/ideas").json()[0]["research"] is None


def test_cli_args_enable_only_web_tools_and_skip_user_mcp():
    cli = ClaudeCli()
    plain = cli.build_args("claude", {})
    assert plain[plain.index("--tools") + 1] == ""
    assert "--strict-mcp-config" in plain and "--allowedTools" not in plain
    web = cli.build_args("claude", {}, ["WebSearch", "WebFetch"])
    assert web[web.index("--tools") + 1] == "WebSearch,WebFetch"
    assert web[web.index("--allowedTools") + 1 :][:2] == ["WebSearch", "WebFetch"]


def test_research_prompt_is_editable(client):
    names = [p["name"] for p in client.get("/api/prompts").json()]
    assert "investigacion" in names
    assert client.get("/api/settings").json()["research_max_searches"] == 6
