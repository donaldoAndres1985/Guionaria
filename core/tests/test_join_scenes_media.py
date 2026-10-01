"""«Unir con la siguiente» desde la etapa de medios (sección 5.4): sin desbloquear escenas."""

from sqlmodel import Session

from guionaria_core.db import get_engine
from guionaria_core.models import Asset, Project, SceneAsset
from tests.media_support import downloaded


def set_duration(asset_id, seconds):
    with Session(get_engine()) as s:
        s.get(Asset, asset_id).duration_s = seconds
        s.commit()


def test_join_in_media_stage_keeps_first_video_and_frees_its_trim(client, media_project, web):
    video, image, *_ = media_project["scenes"]
    v1 = downloaded(client, video, providers=["pexels"])[0]
    set_duration(v1["id"], 30.0)
    client.post(f"/api/scenes/{video}/assets/{v1['id']}:approve")
    framing = client.put(
        f"/api/scenes/{video}/assets/{v1['id']}/framing",
        json={"mode": "none", "trim_in_s": 1.0, "trim_out_s": 2.5},
    )
    assert framing.status_code == 200, framing.text
    i1 = downloaded(client, image, providers=["pexels"])[0]
    client.post(f"/api/scenes/{image}/assets/{i1['id']}:approve")
    before = client.get(f"/api/projects/{media_project['id']}/scenes").json()["scenes"]

    resp = client.post(f"/api/scenes/{video}:join-next")
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert [s["id"] for s in state["scenes"]] == [video, *media_project["scenes"][2:]]
    first = state["scenes"][0]
    assert first["joined_seg_keys"] == ["seg_002"]
    assert first["end_s"] == before[1]["end_s"]  # la suma de los dos tiempos
    assert first["approved_asset_id"] == v1["id"]

    with Session(get_engine()) as s:
        row = s.get(SceneAsset, (video, v1["id"]))
        assert (row.trim_in_s, row.trim_out_s) == (1.0, None)  # el video sigue hasta cubrirla
    media = client.get(f"/api/scenes/{video}/media").json()
    assert media["approved"][0]["asset"]["id"] == v1["id"]
    assert client.get(f"/api/scenes/{image}/media").status_code == 404  # la segunda ya no existe


def test_join_needs_media_on_first_and_open_media(client, media_project, web):
    video, image, *_ = media_project["scenes"]
    i1 = downloaded(client, image, providers=["pexels"])[0]
    client.post(f"/api/scenes/{image}/assets/{i1['id']}:approve")
    resp = client.post(f"/api/scenes/{video}:join-next")
    assert resp.status_code == 400
    assert "no tiene medio aprobado" in resp.json()["detail"]

    with Session(get_engine()) as s:
        s.get(Project, media_project["id"]).status = "MEDIOS_APROBADOS"
        s.commit()
    locked = client.post(f"/api/scenes/{image}:join-next")
    assert locked.status_code == 409
    assert "desbloquéalos" in locked.json()["detail"]
