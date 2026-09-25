import os

from sqlmodel import Session, select

from tests.conftest import wait_job
from tests.media_support import ESCENAS, GUION, downloaded
from tests.test_mcp import Mcp


def second_project(client, fake_claude, channel_id, title="Otro caso"):
    """Otro reel con guion y escenas aprobados (destino de la reutilización)."""
    pid = client.post(
        "/api/projects", json={"channel_id": channel_id, "title": title, "format": "reel"}
    ).json()["id"]
    fake_claude.queue(GUION)
    wait_job(client, client.post(f"/api/projects/{pid}/script:generate").json()["id"])
    client.post(f"/api/projects/{pid}/script:approve")
    fake_claude.queue(ESCENAS)
    wait_job(
        client,
        client.post(f"/api/projects/{pid}/scenes:generate", json={"mode": "all"}).json()["id"],
    )
    client.post(f"/api/projects/{pid}/scenes:approve")
    return pid, [s["id"] for s in client.get(f"/api/projects/{pid}/scenes").json()["scenes"]]


def path_of(home, asset_id):
    from guionaria_core.db import get_engine
    from guionaria_core.models import Asset

    with Session(get_engine()) as s:
        return home / s.get(Asset, asset_id).file_path


def test_identical_downloads_share_disk(client, media_project, web, home):
    video, image, real, _text = media_project["scenes"]
    # El banco simulado devuelve la misma foto para todas las imágenes: contenido idéntico.
    [a1, *_] = downloaded(client, image, providers=["pexels"])
    [a2, *_] = downloaded(client, real, providers=["wikimedia"])
    p1, p2 = path_of(home, a1["id"]), path_of(home, a2["id"])
    assert p1 != p2 and os.path.samefile(p1, p2)  # dos medios, un solo archivo en disco

    client.post(f"/api/scenes/{image}/assets/{a1['id']}:approve", json={"role": "main"})
    [approved] = [
        p for p in (p1.parent.parent / "approved").iterdir() if not p.name.startswith(".")
    ]
    assert os.path.samefile(approved, p1)  # la copia aprobada tampoco ocupa espacio

    stats = client.get("/api/library/stats").json()
    assert stats["saved_bytes"] > 0
    assert stats["duplicate_groups"] >= 1
    assert stats["unique_bytes"] < stats["bytes"]


def test_list_filters_and_facets(client, media_project, web, channel):
    video, image, real, _text = media_project["scenes"]
    downloaded(client, video, providers=["pexels"])
    [img, *_] = downloaded(client, image, providers=["pixabay"])
    client.post(f"/api/scenes/{image}/assets/{img['id']}:approve", json={"role": "main"})

    page = client.get("/api/library").json()
    assert page["total"] == len(page["items"]) >= 2
    assert {f["value"] for f in page["kinds"]} == {"image", "video"}
    first = page["items"][0]
    assert first["project_title"] == "El secuestro" and first["channel_name"] == "Casos Reales"

    videos = client.get("/api/library?kind=video").json()
    assert videos["total"] >= 1 and all(i["asset"]["kind"] == "video" for i in videos["items"])
    used = client.get("/api/library?usage=approved").json()["items"]
    assert [i["asset"]["id"] for i in used] == [img["id"]]
    assert used[0]["used_in"] == [{"scene_id": image, "position": 2, "role": "main"}]
    unused = client.get("/api/library?usage=unused").json()["items"]
    assert img["id"] not in [i["asset"]["id"] for i in unused]
    assert all(
        i["asset"]["provider"] == "pixabay"
        for i in client.get("/api/library?provider=pixabay").json()["items"]
    )
    assert client.get(f"/api/library?channel={channel['id'] + 1}").json()["total"] == 0
    assert (
        client.get(f"/api/library?project={media_project['id']}").json()["total"] == page["total"]
    )
    assert (
        client.get("/api/library?duplicates=true").json()["total"] == 0
    )  # video e imagen distintos
    named = client.get("/api/library", params={"q": img["file_name"][:12]}).json()["items"]
    assert img["id"] in [i["asset"]["id"] for i in named]
    small = client.get("/api/library?page_size=1&page=2").json()
    assert (len(small["items"]), small["page"]) == (1, 2)
    sizes = [i["asset"]["size_bytes"] for i in client.get("/api/library?sort=size").json()["items"]]
    assert sizes == sorted(sizes, reverse=True)


def test_reuse_in_another_project(client, media_project, web, fake_claude, channel, home):
    [img, *_] = downloaded(client, media_project["scenes"][1], providers=["pexels"])
    pid2, scenes2 = second_project(client, fake_claude, channel["id"])
    target = scenes2[1]

    media = client.post(f"/api/library/{img['id']}:reuse", json={"scene_id": target}).json()
    [candidate] = media["candidates"]
    assert (candidate["download_status"], candidate["query"], candidate["provider"]) == (
        "done",
        "biblioteca",
        "pexels",
    )
    new_id = candidate["asset"]["id"]
    assert new_id != img["id"]
    assert os.path.samefile(path_of(home, new_id), path_of(home, img["id"]))
    assert "otro-caso" in str(path_of(home, new_id))  # vive en la carpeta del proyecto destino

    again = client.post(f"/api/library/{img['id']}:reuse", json={"scene_id": target}).json()
    assert len(again["candidates"]) == 1  # no se repite
    approved = client.post(f"/api/scenes/{target}/assets/{new_id}:approve", json={"role": "main"})
    assert approved.status_code == 200

    text_scene = scenes2[3]
    resp = client.post(f"/api/library/{img['id']}:reuse", json={"scene_id": text_scene})
    assert resp.status_code == 409 and "no lleva medio" in resp.json()["detail"]
    assert client.post("/api/library/999:reuse", json={"scene_id": target}).status_code == 404

    item = next(i for i in client.get("/api/library").json()["items"] if i["asset"]["id"] == new_id)
    assert (item["reused_from_id"], item["project_id"]) == (img["id"], pid2)

    # Borrar el proyecto de origen no rompe el medio reutilizado (el enlace duro sobrevive).
    assert client.delete(f"/api/projects/{media_project['id']}").status_code == 204
    assert path_of(home, new_id).exists()
    assert client.get(f"/api/assets/{new_id}/file").status_code == 200


def test_reuse_requires_open_media_stage(client, media_project, web, fake_claude, channel):
    [img, *_] = downloaded(client, media_project["scenes"][1], providers=["pexels"])
    pid2 = client.post(
        "/api/projects",
        json={"channel_id": channel["id"], "title": "Sin escenas", "format": "reel"},
    ).json()["id"]
    fake_claude.queue(GUION)
    wait_job(client, client.post(f"/api/projects/{pid2}/script:generate").json()["id"])
    client.post(f"/api/projects/{pid2}/script:approve")
    fake_claude.queue(ESCENAS)
    wait_job(
        client,
        client.post(f"/api/projects/{pid2}/scenes:generate", json={"mode": "all"}).json()["id"],
    )
    scene = client.get(f"/api/projects/{pid2}/scenes").json()["scenes"][0]["id"]
    resp = client.post(f"/api/library/{img['id']}:reuse", json={"scene_id": scene})
    assert resp.status_code == 409  # escenas sin aprobar


def test_backfill_old_assets(client, media_project, web):
    from guionaria_core.db import get_engine
    from guionaria_core.models import Asset

    [img, *_] = downloaded(client, media_project["scenes"][1], providers=["pexels"])
    with Session(get_engine()) as s:
        for a in s.exec(select(Asset)).all():
            a.sha256 = None
        s.commit()
    client.get("/api/library/stats")
    with Session(get_engine()) as s:
        assert s.get(Asset, img["id"]).sha256 and len(s.get(Asset, img["id"]).sha256) == 64


def test_library_by_mcp(client, media_project, web, fake_claude, channel):
    [img, *_] = downloaded(client, media_project["scenes"][1], providers=["pexels"])
    _pid2, scenes2 = second_project(client, fake_claude, channel["id"])
    mcp = Mcp(client)
    found = mcp.call("search_library", kind="image")
    assert img["id"] in [i["asset_id"] for i in found["items"]]
    media = mcp.call("reuse_media", asset_id=img["id"], scene_id=scenes2[1])
    assert len(media["downloaded"]) == 1


def test_framing_a_hardlinked_approval_keeps_the_original(client, media_project, web, home):
    """Regresión: encuadrar el aprobado (enlace duro al original) no debe cambiar el original."""
    import httpx
    from PIL import Image

    from tests.media_support import jpeg_bytes

    web.respond(
        "https://images.pexels.com/1.jpeg", httpx.Response(200, content=jpeg_bytes(1600, 900))
    )
    scene = media_project["scenes"][1]
    [img, *_] = downloaded(client, scene, providers=["pexels"])
    original = path_of(home, img["id"])
    before = original.read_bytes()
    client.post(f"/api/scenes/{scene}/assets/{img['id']}:approve", json={"role": "main"})
    suggested = client.get(f"/api/scenes/{scene}/assets/{img['id']}/framing").json()[
        "suggested_crop"
    ]
    client.put(
        f"/api/scenes/{scene}/assets/{img['id']}/framing", json={"mode": "crop", "crop": suggested}
    )
    assert original.read_bytes() == before
    with Image.open(original) as im:
        assert im.size == (1600, 900)
    client.put(f"/api/scenes/{scene}/assets/{img['id']}/framing", json={"mode": "blur"})
    client.put(f"/api/scenes/{scene}/assets/{img['id']}/framing", json={"mode": "none"})
    assert original.read_bytes() == before
