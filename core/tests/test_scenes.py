import json
from pathlib import Path

import pytest

from tests.conftest import wait_job

# Canal del fixture: 2 palabras/s. Duraciones: seg_001 2.5 s, seg_002 2.5 s, seg_003 3.0 s.
GUION = {
    "titulo_tentativo": "La llamada",
    "segmentos": [
        {"seccion": "gancho", "texto": "Esto no es una película."},
        {"seccion": "contexto", "texto": "Ocurrió en 2008 en CDMX."},
        {"seccion": "cierre", "texto": "Tenía 19 años y nadie contestó."},
    ],
}

ESCENAS = {
    "escenas": [
        {
            "seg_key": "seg_001",
            "tipo": "real",
            "descripcion_visual": "Video real con estática",
            "busqueda_real": "video secuestro noticia",
            "efecto": "estatica",
            "sfx": "static glitch",
        },
        {
            "seg_key": "seg_002",
            "tipo": "video",
            "descripcion_visual": "Toma aérea de CDMX",
            "busqueda_en": "mexico city aerial",
            "busqueda_alt": "city skyline drone",
            "efecto": "zoom_lento_in",
            "musica": "entra drone grave",
        },
        {
            "seg_key": "seg_002",
            "tipo": "imagen",
            "descripcion_visual": "Calle de noche",
            "busqueda_en": "street night",
        },
        {
            "seg_key": "seg_003",
            "tipo": "texto",
            "descripcion_visual": "Texto sobre negro",
            "texto_pantalla": "SIN RESPUESTA",
            "efecto": "fundido_negro",
        },
    ]
}


def purl(project, suffix=""):
    return f"/api/projects/{project['id']}{suffix}"


@pytest.fixture
def approved(client, fake_claude, project):
    """Proyecto con guion generado y aprobado."""
    fake_claude.queue(GUION)
    job = client.post(purl(project, "/script:generate")).json()
    assert wait_job(client, job["id"])["status"] == "done"
    assert client.post(purl(project, "/script:approve")).status_code == 200
    return project


def generate_scenes(client, fake_claude, project, response=ESCENAS, mode=None):
    if response is not None:
        fake_claude.queue(response)
    body = {"mode": mode} if mode else None
    job = client.post(purl(project, "/scenes:generate"), json=body).json()
    return wait_job(client, job["id"])


def scenes(client, project):
    return client.get(purl(project, "/scenes")).json()


def timings(state):
    return [(s["start_s"], s["end_s"]) for s in state["scenes"]]


def status_of(client, project):
    return client.get(purl(project)).json()["status"]


# --- generación ---


def test_generate_requires_approved_script(client, fake_claude, project):
    job = generate_scenes(client, fake_claude, project, response=None)
    assert job["status"] == "failed"
    assert job["error"] == "Aprueba el guion antes de trabajar las escenas"


def test_generate_all_creates_scenes_with_app_timings(client, fake_claude, approved):
    job = generate_scenes(client, fake_claude, approved)
    assert job["status"] == "done"
    assert job["result"] == {"created": 4, "total": 4}

    state = scenes(client, approved)
    assert state["editable"] is True
    assert state["approved"] is False
    assert [s["media_kind"] for s in state["scenes"]] == ["real", "video", "image", "text"]
    assert [s["position"] for s in state["scenes"]] == [1, 2, 3, 4]
    # seg_002 (2.5 s) se reparte entre sus dos escenas
    assert timings(state) == [(0.0, 2.5), (2.5, 3.75), (3.75, 5.0), (5.0, 8.0)]
    assert state["total_s"] == 8.0
    first = state["scenes"][0]
    assert first["narration"] == "Esto no es una película."
    assert first["query_real"] == "video secuestro noticia"
    assert first["query_en"] is None  # vacío → null
    assert first["sfx"] == "static glitch"
    assert first["status"] == "pending"
    assert state["scenes"][3]["on_screen_text"] == "SIN RESPUESTA"
    assert status_of(client, approved) == "ESCENAS_BORRADOR"


def test_scenes_prompt_contents(client, fake_claude, approved):
    generate_scenes(client, fake_claude, approved)
    prompt = fake_claude.calls[-1]["prompt"]
    assert "seg_002 · contexto · (2.5 s) Ocurrió en 2008 en CDMX." in prompt
    assert "más de 4 s" in prompt  # reel
    assert "9:16" in prompt
    assert "zoom_lento_in, zoom_lento_out, ken_burns" in prompt
    assert "SOLO" not in prompt


@pytest.mark.parametrize(
    ("bad_scene", "error"),
    [
        (
            {"seg_key": "seg_001", "tipo": "video", "descripcion_visual": "x"},
            "busqueda_en es obligatoria para tipo video",
        ),
        (
            {"seg_key": "seg_001", "tipo": "real", "descripcion_visual": "x"},
            "busqueda_real es obligatoria",
        ),
        (
            {"seg_key": "seg_999", "tipo": "negro", "descripcion_visual": "x"},
            "seg_key 'seg_999' no es uno de los pedidos",
        ),
    ],
)
def test_invalid_scenes_are_retried_with_the_error(client, fake_claude, approved, bad_scene, error):
    bad = {"escenas": [bad_scene, *ESCENAS["escenas"]]}
    fake_claude.queue(bad, ESCENAS)
    job = generate_scenes(client, fake_claude, approved, response=None)
    assert job["status"] == "done"
    assert error in fake_claude.calls[-1]["prompt"]


def test_missing_segment_coverage_is_detected(client, fake_claude, approved):
    partial = {"escenas": ESCENAS["escenas"][:1]}
    fake_claude.queue(partial, partial)
    job = generate_scenes(client, fake_claude, approved, response=None)
    assert job["status"] == "failed"
    assert "faltan escenas para: seg_002, seg_003" in job["error"]
    assert scenes(client, approved)["scenes"] == []
    assert status_of(client, approved) == "GUION_APROBADO"


def test_invalid_effect_or_type_rejected_by_schema(client, fake_claude, approved):
    bad = {"escenas": [{**ESCENAS["escenas"][0], "efecto": "explosion"}]}
    fake_claude.queue(bad, bad)
    job = generate_scenes(client, fake_claude, approved, response=None)
    assert job["status"] == "failed"


# --- edición ---


@pytest.fixture
def with_scenes(client, fake_claude, approved):
    generate_scenes(client, fake_claude, approved)
    return approved


def ids(client, project):
    return [s["id"] for s in scenes(client, project)["scenes"]]


def test_update_scene_fields(client, with_scenes):
    sid = ids(client, with_scenes)[1]
    resp = client.patch(
        f"/api/scenes/{sid}",
        json={
            "visual_description": "  Dron sobre Reforma  ",
            "sfx": "",
            "effect": "ken_burns",
            "media_kind": "image",
        },
    )
    assert resp.status_code == 200
    scene = resp.json()
    assert scene["visual_description"] == "Dron sobre Reforma"
    assert scene["sfx"] is None
    assert scene["effect"] == "ken_burns"
    assert scene["media_kind"] == "image"


def test_update_scene_validation(client, with_scenes):
    sid = ids(client, with_scenes)[0]
    assert client.patch(f"/api/scenes/{sid}", json={"effect": "explosion"}).status_code == 422
    assert client.patch(f"/api/scenes/{sid}", json={"media_kind": "gif"}).status_code == 422
    assert client.patch(f"/api/scenes/{sid}", json={"media_kind": None}).status_code == 400
    assert client.patch("/api/scenes/999", json={"sfx": "x"}).status_code == 404


def test_reorder_recomputes_timings(client, with_scenes):
    a, b, c, d = ids(client, with_scenes)
    state = client.post(
        purl(with_scenes, "/scenes:reorder"), json={"scene_ids": [d, a, b, c]}
    ).json()
    assert [s["id"] for s in state["scenes"]] == [d, a, b, c]
    assert timings(state) == [(0.0, 3.0), (3.0, 5.5), (5.5, 6.75), (6.75, 8.0)]
    bad = client.post(purl(with_scenes, "/scenes:reorder"), json={"scene_ids": [a, b]})
    assert bad.status_code == 400


def test_split_and_duplicate(client, with_scenes):
    a, b, c, d = ids(client, with_scenes)
    state = client.post(f"/api/scenes/{b}:split").json()
    assert len(state["scenes"]) == 5
    new = state["scenes"][2]
    assert new["seg_key"] == "seg_002"
    assert new["visual_description"] is None
    assert new["query_en"] == "mexico city aerial"
    # seg_002 ahora tiene 3 escenas: 2.5 s / 3 (con redondeo de los tiempos acumulados)
    durations = [s["end_s"] - s["start_s"] for s in state["scenes"][1:4]]
    assert durations == pytest.approx([2.5 / 3] * 3, abs=0.01)
    assert state["scenes"][3]["end_s"] == 5.0

    state = client.post(f"/api/scenes/{d}:duplicate").json()
    assert state["scenes"][-1]["visual_description"] == "Texto sobre negro"
    assert state["scenes"][-1]["on_screen_text"] == "SIN RESPUESTA"
    assert state["total_s"] == 8.0  # la duración total no cambia: se reparte


def test_delete_scene(client, with_scenes):
    a, b, c, d = ids(client, with_scenes)
    state = client.delete(f"/api/scenes/{c}").json()
    assert [s["id"] for s in state["scenes"]] == [a, b, d]
    assert timings(state) == [(0.0, 2.5), (2.5, 5.0), (5.0, 8.0)]


# --- aprobación ---


def test_approve_writes_exports_and_locks(client, with_scenes, home):
    state = client.post(purl(with_scenes, "/scenes:approve")).json()
    assert state["approved"] is True
    assert state["editable"] is False
    assert status_of(client, with_scenes) == "ESCENAS_APROBADAS"

    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    md = (folder / "escenas.md").read_text(encoding="utf-8")
    assert "# Escenas — El secuestro" in md
    assert (
        "| 2 | 0:02–0:03 | Ocurrió en 2008 en CDMX. | video | Toma aérea de CDMX "
        "| mexico city aerial |" in md
    )
    data = json.loads((folder / "escenas.json").read_text(encoding="utf-8"))
    assert data["formato"] == "reel"
    assert data["escenas"][2]["tipo"] == "imagen"
    assert data["escenas"][2]["inicio_s"] == 3.75

    sid = state["scenes"][0]["id"]
    assert client.patch(f"/api/scenes/{sid}", json={"sfx": "x"}).status_code == 409
    assert client.post(purl(with_scenes, "/scenes:approve")).status_code == 409

    unlocked = client.post(purl(with_scenes, "/scenes:unlock")).json()
    assert unlocked["editable"] is True
    assert status_of(client, with_scenes) == "ESCENAS_BORRADOR"
    assert client.post(purl(with_scenes, "/scenes:unlock")).status_code == 409


def test_approve_blocked_when_segment_has_no_scenes(client, with_scenes):
    d = ids(client, with_scenes)[3]
    client.delete(f"/api/scenes/{d}")
    state = scenes(client, with_scenes)
    assert state["segments_without_scenes"] == ["seg_003"]
    resp = client.post(purl(with_scenes, "/scenes:approve"))
    assert resp.status_code == 409
    assert "seg_003" in resp.json()["detail"]


def test_approve_without_scenes(client, approved):
    assert client.post(purl(approved, "/scenes:approve")).status_code == 409


# --- propagación de cambios del guion ---


def script_segments(client, project):
    script = client.get(purl(project, "/script")).json()
    return [
        {k: s[k] for k in ("seg_key", "section", "text", "needs_fact_check")}
        for s in script["segments"]
    ]


def test_script_change_marks_scenes_and_regenerates_only_pending(client, fake_claude, with_scenes):
    before = scenes(client, with_scenes)["scenes"]
    client.post(purl(with_scenes, "/script:unlock"))
    assert status_of(client, with_scenes) == "GUION_BORRADOR"

    segs = script_segments(client, with_scenes)
    segs[1]["text"] = "Ocurrió en septiembre de 2008, en la Ciudad de México."  # 10 palabras = 5 s
    client.put(purl(with_scenes, "/script"), json={"segments": segs})

    state = scenes(client, with_scenes)
    assert state["editable"] is False  # con el guion desbloqueado no se editan escenas
    assert [s["status"] for s in state["scenes"]] == ["pending", "review", "review", "pending"]
    assert state["review_count"] == 2

    client.post(purl(with_scenes, "/script:approve"))
    state = scenes(client, with_scenes)
    assert state["total_s"] == 10.5  # tiempos recalculados con la nueva duración
    assert state["scenes"][1]["narration"].startswith("Ocurrió en septiembre")

    new_seg2 = {
        "escenas": [
            {
                "seg_key": "seg_002",
                "tipo": "video",
                "descripcion_visual": "Nueva",
                "busqueda_en": "mexico city 2008",
            }
        ]
    }
    job = generate_scenes(client, fake_claude, with_scenes, response=new_seg2, mode="pending")
    assert job["result"] == {"created": 1, "total": 3}
    prompt = fake_claude.calls[-1]["prompt"]
    assert "seg_002" in prompt and "seg_001 ·" not in prompt and "SOLO" in prompt

    after = scenes(client, with_scenes)
    assert [s["seg_key"] for s in after["scenes"]] == ["seg_001", "seg_002", "seg_003"]
    assert after["scenes"][0]["id"] == before[0]["id"]  # se conservan las no afectadas
    assert after["scenes"][2]["id"] == before[3]["id"]
    assert after["review_count"] == 0
    assert timings(after) == [(0.0, 2.5), (2.5, 7.5), (7.5, 10.5)]


def test_pending_with_nothing_to_do_skips_claude(client, fake_claude, with_scenes):
    calls = len(fake_claude.calls)
    job = generate_scenes(client, fake_claude, with_scenes, response=None, mode="pending")
    assert job["result"] == {"created": 0, "total": 4}
    assert len(fake_claude.calls) == calls


def test_removed_segment_scenes_are_flagged_and_cleaned(client, fake_claude, with_scenes):
    client.post(purl(with_scenes, "/script:unlock"))
    segs = script_segments(client, with_scenes)
    client.put(purl(with_scenes, "/script"), json={"segments": segs[:2]})  # sin seg_003
    client.post(purl(with_scenes, "/script:approve"))

    state = scenes(client, with_scenes)
    assert state["scenes"][3]["segment_missing"] is True
    assert state["review_count"] == 1
    assert client.post(purl(with_scenes, "/scenes:approve")).status_code == 409

    job = generate_scenes(client, fake_claude, with_scenes, response=None, mode="pending")
    assert job["result"] == {"created": 0, "total": 3}
    assert [s["seg_key"] for s in scenes(client, with_scenes)["scenes"]] == [
        "seg_001",
        "seg_002",
        "seg_002",
    ]


def test_regenerate_all_replaces_everything(client, fake_claude, with_scenes):
    only_black = {
        "escenas": [
            {"seg_key": k, "tipo": "negro", "descripcion_visual": f"Negro {k}"}
            for k in ("seg_001", "seg_002", "seg_003")
        ]
    }
    job = generate_scenes(client, fake_claude, with_scenes, response=only_black, mode="all")
    assert job["result"] == {"created": 3, "total": 3}
    state = scenes(client, with_scenes)
    assert [s["media_kind"] for s in state["scenes"]] == ["black", "black", "black"]
    assert [s["visual_description"] for s in state["scenes"]] == [
        "Negro seg_001",
        "Negro seg_002",
        "Negro seg_003",
    ]


def test_mark_reviewed_and_edit_clear_review(client, with_scenes):
    client.post(purl(with_scenes, "/script:unlock"))
    segs = script_segments(client, with_scenes)
    segs[1]["text"] = "Cambio."
    client.put(purl(with_scenes, "/script"), json={"segments": segs})
    client.post(purl(with_scenes, "/script:approve"))
    _, b, c, _ = ids(client, with_scenes)
    assert client.post(f"/api/scenes/{b}:reviewed").json()["status"] == "pending"
    assert client.patch(f"/api/scenes/{c}", json={"sfx": "whoosh"}).json()["status"] == "pending"
    assert scenes(client, with_scenes)["review_count"] == 0


# --- exportación y borrado ---


def test_export_md_and_csv(client, with_scenes):
    md = client.post(purl(with_scenes, "/scenes:export"), params={"format": "md"}).json()
    assert md["path"].endswith("escenas.md")
    csv_res = client.post(purl(with_scenes, "/scenes:export"), params={"format": "csv"}).json()
    raw = Path(csv_res["path"]).read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("#,Inicio–Fin,Narración,Tipo")
    assert "mexico city aerial" in text
    assert (
        client.post(purl(with_scenes, "/scenes:export"), params={"format": "pdf"}).status_code
        == 422
    )


def test_export_without_scenes(client, approved):
    assert client.post(purl(approved, "/scenes:export")).status_code == 409


def test_delete_project_with_scenes(client, with_scenes):
    assert client.delete(purl(with_scenes)).status_code == 204
