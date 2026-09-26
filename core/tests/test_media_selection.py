"""«Elegir = usar»: la selección se guarda y «Descargar y aprobar» deja cada escena con medio."""

from tests.conftest import wait_job
from tests.media_support import search, status_of


def select(client, scene, candidate, selected=True):
    resp = client.put(
        f"/api/scenes/{scene}/candidates/{candidate}/selected", json={"selected": selected}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def overview(client, pid):
    return client.get(f"/api/projects/{pid}/media").json()


def download_selected(client, pid):
    job = client.post(f"/api/projects/{pid}/media:download-selected")
    assert job.status_code == 202, job.text
    return wait_job(client, job.json()["id"])


def candidates(client, scene):
    return client.get(f"/api/scenes/{scene}/media").json()["candidates"]


def test_selection_is_saved_in_order_and_survives_new_searches(client, media_project, web):
    video, image, real, _text = media_project["scenes"]
    first, second = [c["id"] for c in search(client, image).json()["scene"]["candidates"][:2]]
    select(client, image, second)
    media = select(client, image, first)
    order = {c["id"]: c["selection_order"] for c in media["candidates"] if c["selected"]}
    assert order == {second: 1, first: 2}

    # Otra búsqueda descarta lo no elegido pero conserva lo elegido (con su orden).
    search(client, image, query="otra cosa")
    kept = {c["id"]: c["selection_order"] for c in candidates(client, image) if c["selected"]}
    assert kept == {second: 1, first: 2}

    select(client, image, second, selected=False)
    row = next(s for s in overview(client, media_project["id"])["scenes"] if s["scene_id"] == image)
    assert row["selected_count"] == 1
    assert overview(client, media_project["id"])["selected_pending"] == 1


def test_download_selected_approves_first_choice_of_every_scene(client, media_project, web):
    pid = media_project["id"]
    video, image, real, _text = media_project["scenes"]
    picks = {}
    for scene in (video, image, real):
        found = search(client, scene).json()["scene"]["candidates"]
        # En la escena de imagen se eligen dos: el segundo elegido queda como alternativa.
        chosen = found[:2] if scene == image else found[:1]
        for c in reversed(chosen):
            select(client, scene, c["id"])
        picks[scene] = chosen[-1]["id"]  # elegido primero (orden 1)

    assert overview(client, pid)["selected_pending"] == 4
    job = download_selected(client, pid)
    assert job["status"] == "done", job
    assert job["result"] == {"requested": 4, "downloaded": 4, "failed": 0, "approved": 3}

    data = overview(client, pid)
    assert data["with_media"] == data["needing_media"] == 3
    assert data["selected_pending"] == 0
    for scene, candidate_id in picks.items():
        media = client.get(f"/api/scenes/{scene}/media").json()
        chosen = next(c for c in media["candidates"] if c["id"] == candidate_id)
        [main] = [a for a in media["approved"] if a["role"] == "main"]
        assert main["asset"]["id"] == chosen["asset"]["id"]

    # Con todas las escenas con medio ya se pueden aprobar los medios.
    assert client.post(f"/api/projects/{pid}/media:approve").status_code == 200
    assert status_of(client, pid) == "MEDIOS_APROBADOS"
    assert client.post(f"/api/projects/{pid}/media:download-selected").status_code == 400


def test_download_selected_keeps_existing_main_and_skips_failures(client, media_project, web):
    import httpx

    pid = media_project["id"]
    video = media_project["scenes"][0]
    [a, b] = [c["id"] for c in search(client, video).json()["scene"]["candidates"][:2]]
    select(client, video, a)
    web.respond("https://videos.pexels.com", httpx.Response(404))  # el elegido no se puede bajar
    web.respond("https://cdn.pixabay.com", httpx.Response(404))
    job = download_selected(client, pid)
    assert job["result"]["failed"] == 1
    assert job["result"]["approved"] == 0
    # Falló: sigue elegido para reintentar.
    assert overview(client, pid)["selected_pending"] == 1

    web.overrides.clear()
    select(client, video, b)
    job = download_selected(client, pid)
    assert job["result"]["approved"] == 1
    media = client.get(f"/api/scenes/{video}/media").json()
    [main] = [x for x in media["approved"] if x["role"] == "main"]
    first = next(c for c in media["candidates"] if c["id"] == a)
    assert main["asset"]["id"] == first["asset"]["id"]  # el primero elegido, aunque se bajó después


def test_select_rejects_foreign_candidate(client, media_project, web):
    video, image = media_project["scenes"][:2]
    other = search(client, image).json()["scene"]["candidates"][0]["id"]
    resp = client.put(f"/api/scenes/{video}/candidates/{other}/selected", json={"selected": True})
    assert resp.status_code == 404
