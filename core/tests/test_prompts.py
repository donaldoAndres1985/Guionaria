from guionaria_core.services import prompts


def test_startup_copies_default_prompts(client, home):
    for name in prompts.PROMPTS:
        path = home / "config" / "prompts" / f"{name}.md"
        assert path.read_text(encoding="utf-8") == prompts.default_content(name)


def test_user_edits_are_kept_and_reset(client, home):
    resp = client.put("/api/prompts/guion", json={"content": "Mi prompt {canal}"})
    assert resp.status_code == 200
    assert resp.json()["is_default"] is False
    assert prompts.load_prompt("guion") == "Mi prompt {canal}"

    listed = {p["name"]: p for p in client.get("/api/prompts").json()}
    assert listed["guion"]["content"] == "Mi prompt {canal}"
    assert listed["reescribir_segmento"]["is_default"] is True

    reset = client.post("/api/prompts/guion:reset").json()
    assert reset["is_default"] is True


def test_existing_user_prompt_not_overwritten_on_startup(home):
    (home / "config" / "prompts").mkdir(parents=True)
    (home / "config" / "prompts" / "guion.md").write_text("propio", encoding="utf-8")
    prompts.ensure_prompts()
    assert prompts.load_prompt("guion") == "propio"


def test_unknown_prompt_is_404(client):
    assert client.put("/api/prompts/otro", json={"content": "x"}).status_code == 404


def test_render_replaces_known_keys_only():
    template = 'Canal {canal}. Ejemplo: {"clave": 1} y {desconocida}.'
    assert prompts.render(template, canal="X") == 'Canal X. Ejemplo: {"clave": 1} y {desconocida}.'


def test_default_prompts_use_only_supported_placeholders():
    import re

    supported = {
        "guion": {
            "canal",
            "estilo",
            "formato",
            "relacion",
            "duracion",
            "duracion_s",
            "palabras_objetivo",
            "estructura",
            "idioma",
            "titulo",
            "tema",
            "notas",
            "fecha",
        },
        "reescribir_segmento": {
            "canal",
            "estilo",
            "idioma",
            "guion",
            "notas",
            "fragmento",
            "instruccion",
        },
        "escenas": {
            "canal",
            "estilo",
            "formato",
            "relacion",
            "max_escena_s",
            "lista_efectos",
            "guion",
        },
        "busquedas_alternativas": {
            "canal",
            "tipo",
            "orientacion",
            "narracion",
            "descripcion",
            "busqueda_actual",
        },
    }
    for name, keys in supported.items():
        used = set(re.findall(r"\{(\w+)\}", prompts.default_content(name)))
        assert used <= keys, f"{name}: {used - keys}"
