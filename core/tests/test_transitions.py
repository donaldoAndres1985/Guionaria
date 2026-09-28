"""Transiciones entre escenas: la de por defecto, la de cada corte y la unión con xfade."""

from guionaria_core.config import TransitionPrefs
from guionaria_core.services.render import plan, transitions
from guionaria_core.services.render.transitions import Cut
from tests.test_mcp_new import mcp  # noqa: F401  (fixture)


def test_resolve_uses_default_override_and_room():
    prefs = TransitionPrefs(default="fade", duration=0.5)
    cuts = transitions.resolve(
        [None, "circleopen", "none", "desconocida"], [3, 3, 0.6, 2, 2], prefs
    )
    assert [(c.transition, c.duration) for c in cuts] == [
        ("fade", 0.5),  # la de por defecto
        ("circleopen", 0.27),  # la escena siguiente dura 0,6 s: se acorta al 45 %
        (None, 0.0),  # corte directo elegido
        (None, 0.0),  # un id desconocido no se aplica
    ]
    # Sin transición por defecto, solo los cortes elegidos.
    none = transitions.resolve([None, "wipeleft"], [2, 2, 2], TransitionPrefs())
    assert [c.transition for c in none] == [None, "wipeleft"]
    # Escenas demasiado cortas: corte directo.
    assert transitions.resolve(["fade"], [0.2, 3], prefs)[0].transition is None


def test_join_filter_mixes_cuts_and_transitions():
    cuts = [Cut(0, "slideleft", 0.4), Cut(1, None, 0), Cut(2, "fadeblack", 0.5)]
    graph, label = plan.join_filter(4, cuts, [0, 2.0, 4.0, 5.0])
    assert label == "j3"
    assert "[0:v]settb=AVTB,fps=30[s0]" in graph
    assert "[s0][s1]xfade=transition=slideleft:duration=0.400:offset=2.000[j1]" in graph
    assert "[j1][s2]concat=n=2:v=1:a=0[j2]" in graph
    assert "[j2][s3]xfade=transition=fadeblack:duration=0.500:offset=5.000[j3]" in graph


def test_transitions_api(client, media_project):
    pid = media_project["id"]
    state = client.get(f"/api/projects/{pid}/transitions").json()
    assert state["default"] == "none" and state["duration"] == 0.5
    assert state["options"][0] == {"id": "none", "label": "Corte directo"}
    assert {"id": "fade", "label": "Fundido cruzado"} in state["options"]
    assert [c["position"] for c in state["cuts"]] == [1, 2, 3]
    assert all(c["transition"] is None for c in state["cuts"])
    assert state["cuts"][2]["to_kind"] == "text"

    # Por defecto para todos los cortes; uno con la suya y otro con corte directo.
    state = client.put(
        f"/api/projects/{pid}/transitions", json={"default": "fade", "duration": 0.3}
    ).json()
    assert [c["transition"] for c in state["cuts"]] == ["fade", "fade", "fade"]
    first, second = state["cuts"][0]["scene_id"], state["cuts"][1]["scene_id"]
    client.put(f"/api/scenes/{first}/transition", json={"transition": "circleopen"})
    state = client.put(f"/api/scenes/{second}/transition", json={"transition": "none"}).json()
    assert [(c["chosen"], c["transition"]) for c in state["cuts"]] == [
        ("circleopen", "circleopen"),
        ("none", None),
        (None, "fade"),
    ]
    assert state["cuts"][0]["duration_s"] == 0.3

    # La vista previa sabe con qué entra cada escena.
    scenes = client.get(f"/api/projects/{pid}/timeline/preview").json()["scenes"]
    assert [(s["transition_in"], s["transition_in_s"]) for s in scenes] == [
        (None, 0.0),
        ("circleopen", 0.3),
        (None, 0.0),
        ("fade", 0.3),
    ]

    bad = client.put(f"/api/scenes/{first}/transition", json={"transition": "explosion"})
    assert bad.status_code == 400 and "desconocida" in bad.json()["detail"]
    # «Aplicar a todos»: los cortes vuelven a la de por defecto.
    state = client.put(f"/api/projects/{pid}/transitions", json={"reset_cuts": True}).json()
    assert [c["chosen"] for c in state["cuts"]] == [None, None, None]


def test_mcp_set_transitions(client, media_project, mcp):  # noqa: F811
    pid = media_project["id"]
    state = mcp.call("set_transitions", project_id=pid, default="fadeblack", cuts={"2": "wipeleft"})
    assert [c["transition"] for c in state["cuts"]] == ["fadeblack", "wipeleft", "fadeblack"]
