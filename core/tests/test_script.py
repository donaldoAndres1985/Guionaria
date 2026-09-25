from sqlmodel import Session, select

from guionaria_core.db import get_engine
from guionaria_core.models import Scene
from guionaria_core.services.llm.claude_cli import ClaudeError
from tests.conftest import wait_job

GUION = {
    "titulo_tentativo": "La llamada",
    "segmentos": [
        {"seccion": "Gancho", "texto": "Esto no es una película.", "verificar_dato": False},
        {"seccion": "contexto", "texto": "Ocurrió en 2008 en CDMX.", "verificar_dato": False},
        {"seccion": "cierre", "texto": "Tenía 19 años y nadie contestó.", "verificar_dato": True},
    ],
    "fuentes_sugeridas": ["Diario X"],
}


def url(project, suffix=""):
    return f"/api/projects/{project['id']}/script{suffix}"


def generate(client, fake_claude, project, response=GUION):
    fake_claude.queue(response)
    job = client.post(url(project, ":generate"))
    assert job.status_code == 202
    return wait_job(client, job.json()["id"])


def segments_payload(script):
    return [
        {k: s[k] for k in ("seg_key", "section", "text", "needs_fact_check")}
        for s in script["segments"]
    ]


def save(client, project, segments):
    return client.put(url(project), json={"segments": segments})


# --- generación ---


def test_generate_creates_first_version(client, fake_claude, project):
    job = generate(client, fake_claude, project)
    assert job["status"] == "done"
    assert job["result"] == {
        "version": 1,
        "segments": 3,
        "titulo_sugerido": "La llamada",
        "fuentes_sugeridas": ["Diario X"],
    }

    script = client.get(url(project)).json()
    assert script["version"] == 1
    assert script["source"] == "claude"
    assert [s["seg_key"] for s in script["segments"]] == ["seg_001", "seg_002", "seg_003"]
    assert script["segments"][0]["section"] == "gancho"  # normalizado a minúsculas
    assert script["segments"][2]["needs_fact_check"] is True
    # 5 palabras / 2 palabras por segundo del canal
    assert script["segments"][0]["est_duration_s"] == 2.5
    assert script["sections"] == ["gancho", "contexto", "cierre"]
    assert script["target_duration_s"] == 60

    assert client.get(f"/api/projects/{project['id']}").json()["status"] == "GUION_BORRADOR"


def test_prompt_includes_channel_project_and_notes(client, fake_claude, project):
    generate(client, fake_claude, project)
    call = fake_claude.calls[0]
    for expected in (
        "Casos Reales",
        "Sobrio y respetuoso",
        "reel / short",
        "9:16",
        "Caso Priscila",
        "Ocurrió en 2008",
        "gancho, contexto, cierre",
        "~120 palabras",
    ):
        assert expected in call["prompt"], expected
    assert call["schema"]["required"] == ["titulo_tentativo", "segmentos"]
    assert str(call["cwd"]).endswith("_el-secuestro_reel")


def test_generation_failure_keeps_project_in_idea(client, fake_claude, project):
    fake_claude.queue(ClaudeError("Se alcanzó el límite de uso de tu plan de Claude."))
    job = client.post(url(project, ":generate")).json()
    job = wait_job(client, job["id"])
    assert job["status"] == "failed"
    assert "límite de uso" in job["error"]
    assert client.get(url(project)).status_code == 404
    assert client.get(f"/api/projects/{project['id']}").json()["status"] == "IDEA"


def test_invalid_claude_answer_is_retried(client, fake_claude, project):
    fake_claude.queue({"segmentos": []})  # inválido: falta título y segmentos vacíos
    job = generate(client, fake_claude, project)
    assert job["status"] == "done"
    assert len(fake_claude.calls) == 2
    assert "no fue válida" in fake_claude.calls[1]["prompt"]


def test_regenerate_creates_new_version_with_new_keys(client, fake_claude, project):
    generate(client, fake_claude, project)
    generate(client, fake_claude, project)
    script = client.get(url(project)).json()
    assert script["version"] == 2
    assert [s["seg_key"] for s in script["segments"]] == ["seg_004", "seg_005", "seg_006"]


def test_generate_unknown_project_404(client, fake_claude):
    assert client.post("/api/projects/999/script:generate").status_code == 404


# --- edición y versiones ---


def test_save_edit_creates_version_and_keeps_keys(client, fake_claude, project):
    generate(client, fake_claude, project)
    segs = segments_payload(client.get(url(project)).json())
    segs[1]["text"] = "Ocurrió en 2008, en Ciudad de México."
    saved = save(client, project, segs).json()
    assert saved["version"] == 2
    assert saved["source"] == "manual"
    assert [s["seg_key"] for s in saved["segments"]] == ["seg_001", "seg_002", "seg_003"]

    versions = client.get(url(project, "/versions")).json()
    assert [(v["version"], v["status"]) for v in versions] == [(2, "draft"), (1, "superseded")]


def test_save_without_changes_does_not_create_version(client, fake_claude, project):
    generate(client, fake_claude, project)
    segs = segments_payload(client.get(url(project)).json())
    assert save(client, project, segs).json()["version"] == 1
    assert len(client.get(url(project, "/versions")).json()) == 1


def test_key_rules_new_duplicate_and_unknown(client, fake_claude, project):
    generate(client, fake_claude, project)
    segs = segments_payload(client.get(url(project)).json())
    # Dividir seg_002: el editor manda la segunda mitad con la misma clave (duplicada).
    first, second = dict(segs[1]), dict(segs[1])
    first["text"], second["text"] = "Ocurrió en 2008.", "Fue en CDMX."
    new = {
        "seg_key": None,
        "section": "cierre",
        "text": "Segmento nuevo.",
        "needs_fact_check": False,
    }
    alien = {
        "seg_key": "seg_999",
        "section": "cierre",
        "text": "Pegado.",
        "needs_fact_check": False,
    }
    saved = save(client, project, [segs[0], first, second, new, alien, segs[2]]).json()
    assert [s["seg_key"] for s in saved["segments"]] == [
        "seg_001",
        "seg_002",
        "seg_004",
        "seg_005",
        "seg_006",
        "seg_003",
    ]


def test_deleted_keys_are_never_reused(client, fake_claude, project):
    generate(client, fake_claude, project)
    segs = segments_payload(client.get(url(project)).json())
    save(client, project, segs[:1])  # borra seg_002 y seg_003
    saved = save(client, project, [segs[0], {"text": "Nuevo.", "section": "cierre"}]).json()
    assert saved["segments"][1]["seg_key"] == "seg_004"


def test_save_validation(client, fake_claude, project):
    assert save(client, project, []).status_code == 422
    assert save(client, project, [{"text": ""}]).status_code == 422


def test_manual_script_without_claude(client, project):
    saved = save(client, project, [{"text": "Escrito a mano.", "section": "gancho"}])
    assert saved.status_code == 200
    assert saved.json()["segments"][0]["seg_key"] == "seg_001"
    assert client.get(f"/api/projects/{project['id']}").json()["status"] == "GUION_BORRADOR"


def test_read_specific_version_and_restore(client, fake_claude, project):
    generate(client, fake_claude, project)
    segs = segments_payload(client.get(url(project)).json())
    segs[0]["text"] = "Texto cambiado."
    save(client, project, segs)

    v1 = client.get(url(project), params={"version": 1}).json()
    assert v1["segments"][0]["text"] == "Esto no es una película."
    assert client.get(url(project), params={"version": 9}).status_code == 404

    restored = client.post(url(project, "/versions/1:restore")).json()
    assert restored["version"] == 3
    assert restored["source"] == "restore:v1"
    assert restored["segments"][0]["text"] == "Esto no es una película."
    assert restored["segments"][0]["seg_key"] == "seg_001"


def test_script_text_is_searchable(client, fake_claude, project):
    generate(client, fake_claude, project)
    hits = client.get("/api/projects", params={"q": "película"}).json()
    assert [p["id"] for p in hits] == [project["id"]]


# --- aprobación y desbloqueo ---


def test_approve_locks_and_writes_markdown(client, fake_claude, project, home):
    generate(client, fake_claude, project)
    approved = client.post(url(project, ":approve")).json()
    assert approved["status"] == "approved"
    assert client.get(f"/api/projects/{project['id']}").json()["status"] == "GUION_APROBADO"

    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    md = (folder / "guion.md").read_text(encoding="utf-8")
    assert md.startswith("# El secuestro")
    assert "## Gancho" in md
    assert "Tenía 19 años y nadie contestó. ⚠ verificar dato" in md

    segs = segments_payload(approved)
    assert save(client, project, segs).status_code == 409
    assert client.post(url(project, ":approve")).status_code == 409
    fake_claude.queue(GUION)
    assert client.post(url(project, ":generate")).status_code == 202  # se encola…
    # …pero falla porque el guion está aprobado
    job = client.get(f"/api/jobs?project_id={project['id']}").json()[0]
    assert wait_job(client, job["id"])["error"].startswith("El guion está aprobado")


def test_approve_without_script(client, project):
    assert client.post(url(project, ":approve")).status_code == 409


def test_unlock_and_propagation_to_scenes(client, fake_claude, project):
    generate(client, fake_claude, project)
    client.post(url(project, ":approve"))
    with Session(get_engine()) as s:
        for key in ("seg_001", "seg_002"):
            s.add(
                Scene(
                    project_id=project["id"],
                    seg_key=key,
                    position=1,
                    media_kind="video",
                    status="approved",
                )
            )
        s.commit()

    unlocked = client.post(url(project, ":unlock")).json()
    assert unlocked == {"scenes_to_review": 2}
    assert client.get(f"/api/projects/{project['id']}").json()["status"] == "GUION_BORRADOR"
    assert client.post(url(project, ":unlock")).status_code == 409

    segs = segments_payload(client.get(url(project)).json())
    segs[1]["text"] = "Texto corregido."
    save(client, project, segs)
    with Session(get_engine()) as s:
        statuses = {sc.seg_key: sc.status for sc in s.exec(select(Scene)).all()}
    assert statuses == {"seg_001": "approved", "seg_002": "review"}


def test_delete_project_with_script(client, fake_claude, project):
    generate(client, fake_claude, project)
    assert client.delete(f"/api/projects/{project['id']}").status_code == 204


# --- reescritura con Claude ---


def test_rewrite_fragment(client, fake_claude, project):
    generate(client, fake_claude, project)
    fake_claude.queue({"texto": '"Nadie contestó aquella noche."', "verificar_dato": False})
    resp = client.post(
        url(project, "/segments/seg_003:rewrite"),
        json={"instruccion": "más dramático", "fragmento": "nadie contestó"},
    ).json()
    assert resp == {
        "seg_key": "seg_003",
        "fragmento": "nadie contestó",
        "texto": "Nadie contestó aquella noche.",
        "verificar_dato": False,
    }
    prompt = fake_claude.calls[-1]["prompt"]
    assert '"nadie contestó"' in prompt
    assert "más dramático" in prompt
    assert "Esto no es una película." in prompt  # guion como contexto
    # La reescritura no guarda: el usuario decide si la acepta.
    assert client.get(url(project)).json()["version"] == 1


def test_rewrite_whole_segment_when_no_fragment(client, fake_claude, project):
    generate(client, fake_claude, project)
    fake_claude.queue({"texto": "Otro texto.", "verificar_dato": True})
    resp = client.post(url(project, "/segments/seg_001:rewrite"), json={"instruccion": "corto"})
    assert resp.json()["fragmento"] == "Esto no es una película."
    assert resp.json()["verificar_dato"] is True


def test_rewrite_errors(client, fake_claude, project):
    generate(client, fake_claude, project)
    missing = client.post(url(project, "/segments/seg_404:rewrite"), json={"instruccion": "x"})
    assert missing.status_code == 404
    unsaved = client.post(
        url(project, "/segments/seg_001:rewrite"),
        json={"instruccion": "x", "fragmento": "texto que no existe"},
    )
    assert unsaved.status_code == 400
    assert (
        client.post(url(project, "/segments/seg_001:rewrite"), json={"instruccion": ""}).status_code
        == 422
    )

    fake_claude.queue(ClaudeError("Claude devolvió un error: caído"))
    failed = client.post(url(project, "/segments/seg_001:rewrite"), json={"instruccion": "x"})
    assert failed.status_code == 502
    assert failed.json()["detail"] == "Claude devolvió un error: caído"

    client.post(url(project, ":approve"))
    locked = client.post(url(project, "/segments/seg_001:rewrite"), json={"instruccion": "x"})
    assert locked.status_code == 409


def test_operations_logged(client, fake_claude, project):
    from guionaria_core.models import OperationLog

    generate(client, fake_claude, project)
    client.post(url(project, ":approve"))
    client.post(url(project, ":unlock"))
    with Session(get_engine()) as s:
        ops = [(o.entity, o.action, o.actor) for o in s.exec(select(OperationLog)).all()]
    assert ("script", "save", "system") in ops
    assert ("script", "approve", "ui") in ops
    assert ("script", "unlock", "ui") in ops
