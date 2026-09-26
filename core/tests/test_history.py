import os
from datetime import UTC, datetime, timedelta

import httpx
from sqlmodel import Session

from tests.media_support import downloaded, jpeg_bytes
from tests.test_mcp import Mcp


def project_folder(client, pid):
    return client.get(f"/api/projects/{pid}").json()["folder_path"]


# --- papelera ---


def test_trash_and_restore_keeps_everything(client, media_project, web, home):
    pid = media_project["id"]
    image = media_project["scenes"][1]
    [a, *_] = downloaded(client, image, providers=["pexels"])
    client.post(f"/api/scenes/{image}/assets/{a['id']}:approve", json={"role": "main"})
    folder = project_folder(client, pid)

    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert not os.path.exists(folder)
    assert client.get(f"/api/projects/{pid}").status_code == 404  # oculto para la app
    assert all(p["id"] != pid for p in client.get("/api/projects").json())
    assert client.get("/api/library").json()["total"] == 0  # sus medios salen de la biblioteca
    [item] = client.get("/api/trash").json()
    assert (item["project_id"], item["title"], item["days_left"]) == (pid, "El secuestro", 30)
    assert item["bytes"] > 0

    restored = client.post(f"/api/trash/{pid}:restore").json()
    assert restored["folder_path"] == folder and os.path.exists(folder)
    assert client.get("/api/trash").json() == []
    media = client.get(f"/api/scenes/{image}/media").json()
    assert media["approved"][0]["asset"]["id"] == a["id"]
    assert client.get(media["approved"][0]["approved_url"]).status_code == 200
    assert len(client.get(f"/api/projects/{pid}/scenes").json()["scenes"]) == 4


def test_restore_when_the_folder_name_is_taken(client, media_project, web, home, channel):
    pid = media_project["id"]
    image = media_project["scenes"][1]
    [a, *_] = downloaded(client, image, providers=["pexels"])
    client.post(f"/api/scenes/{image}/assets/{a['id']}:approve", json={"role": "main"})
    folder = project_folder(client, pid)
    client.delete(f"/api/projects/{pid}")
    os.makedirs(folder)  # otra carpeta ocupa el nombre (p. ej. un proyecto nuevo igual)

    restored = client.post(f"/api/trash/{pid}:restore").json()
    assert restored["folder_path"] == folder + "-restaurado-2"
    media = client.get(f"/api/scenes/{image}/media").json()
    # Las rutas guardadas se actualizaron: el aprobado y el candidato siguen accesibles.
    assert client.get(media["approved"][0]["approved_url"]).status_code == 200
    assert client.get(f"/api/assets/{a['id']}/file").status_code == 200


def test_purge_and_empty(client, media_project, web, home, channel):
    pid = media_project["id"]
    client.delete(f"/api/projects/{pid}")
    trash_dir = home / "trash"
    assert any(trash_dir.iterdir())
    assert client.delete(f"/api/trash/{pid}").status_code == 204
    assert client.get("/api/trash").json() == []
    assert not any(trash_dir.iterdir())
    assert client.post(f"/api/trash/{pid}:restore").status_code == 404

    other = client.post(
        "/api/projects", json={"channel_id": channel["id"], "title": "Otro", "format": "reel"}
    ).json()
    client.delete(f"/api/projects/{other['id']}")
    assert client.post("/api/trash:empty").json() == {"purged": 1}


def test_expired_projects_are_purged_on_startup(client, project, home):
    from guionaria_core.db import get_engine
    from guionaria_core.models import Project
    from guionaria_core.services.trash import purge_expired

    client.delete(f"/api/projects/{project['id']}")
    with Session(get_engine()) as s:
        p = s.get(Project, project["id"])
        p.deleted_at = (datetime.now(UTC) - timedelta(days=31)).isoformat(timespec="seconds")
        s.commit()
        assert purge_expired(s) == 1
        assert s.get(Project, project["id"]) is None


def test_channel_delete_purges_its_trash(client, project, channel):
    client.delete(f"/api/projects/{project['id']}")
    assert client.delete(f"/api/channels/{channel['id']}").status_code == 204
    assert client.get("/api/trash").json() == []


# --- historial ---


def test_history_texts_actors_and_filters(client, media_project, web, channel):
    pid = media_project["id"]
    image = media_project["scenes"][1]
    [a, *_] = downloaded(client, image, providers=["pexels"])
    client.post(f"/api/scenes/{image}/assets/{a['id']}:approve", json={"role": "main"})
    Mcp(client).call("add_ideas", channel="Casos Reales", items=[{"title": "Desde Claude"}])

    page = client.get("/api/history").json()
    texts = [i["text"] for i in page["items"]]
    assert "Medio aprobado en la escena 2" in texts
    assert "Escenas aprobadas (4)" in texts
    assert "Guion aprobado (versión 1)" in texts
    assert "Guion guardado con Claude (versión 1)" in texts or any(
        t.startswith("Guion guardado") for t in texts
    )
    assert any(t.startswith("Descarga de medios: ") and t.endswith("(escena 2)") for t in texts)
    assert "Proyecto creado (reel 9:16)" in texts
    idea = next(i for i in page["items"] if i["entity"] == "idea")
    assert (idea["text"], idea["actor"]) == ("Idea guardada: «Desde Claude»", "mcp")
    approved = next(i for i in page["items"] if i["text"] == "Medio aprobado en la escena 2")
    assert (approved["project_id"], approved["project_title"]) == (pid, "El secuestro")
    # Más recientes primero.
    ids = [i["id"] for i in page["items"]]
    assert ids == sorted(ids, reverse=True)

    assert {i["actor"] for i in client.get("/api/history?actor=mcp").json()["items"]} == {"mcp"}
    media_group = client.get("/api/history?group=media").json()["items"]
    assert media_group and {i["entity"] for i in media_group} <= {"media", "asset", "scene"}
    assert all(
        i["project_id"] == pid for i in client.get(f"/api/history?project={pid}").json()["items"]
    )

    first = client.get("/api/history?limit=2").json()
    assert len(first["items"]) == 2 and first["next_before"]
    second = client.get(f"/api/history?limit=2&before={first['next_before']}").json()
    assert second["items"][0]["id"] < first["items"][-1]["id"]


def test_history_offers_restore_while_in_trash(client, project):
    client.delete(f"/api/projects/{project['id']}")
    item = client.get("/api/history").json()["items"][0]
    assert (item["text"], item["can_restore"], item["project_title"]) == (
        "Proyecto enviado a la papelera",
        True,
        "El secuestro",
    )
    client.post(f"/api/trash/{project['id']}:restore")
    items = client.get("/api/history").json()["items"]
    assert items[0]["text"] == "Proyecto restaurado desde la papelera"
    assert not next(i for i in items if i["action"] == "delete")["can_restore"]


# --- derechos ---


def test_rights_report_and_export(client, media_project, web, home):
    pid = media_project["id"]
    video, image, real, _text = media_project["scenes"]
    web.respond(
        "https://images.pexels.com/1.jpeg", httpx.Response(200, content=jpeg_bytes(900, 1600))
    )
    [stock, *_] = downloaded(client, image, providers=["pexels"])
    client.post(f"/api/scenes/{image}/assets/{stock['id']}:approve", json={"role": "main"})
    [web_img, *_] = downloaded(client, real, providers=["searxng"])
    client.post(f"/api/scenes/{real}/assets/{web_img['id']}:approve", json={"role": "main"})

    report = client.get(f"/api/projects/{pid}/rights").json()
    rows = {r["scene_position"]: r for r in report["rows"]}
    assert rows[2]["origin"] == "Pexels" and not rows[2]["needs_review"]
    assert rows[3]["origin"] == "Tercero" and rows[3]["needs_review"]  # web sin licencia clara
    assert report["review_count"] == 1
    assert report["credits"].startswith("Créditos — El secuestro")

    path = client.post(f"/api/projects/{pid}/rights:export").json()["path"]
    with open(path, encoding="utf-8-sig") as fh:
        content = fh.read()
    assert content.splitlines()[0].startswith("Escena,Inicio,Uso,Archivo,Origen")
    assert ",sí" in content
    assert os.path.exists(os.path.join(os.path.dirname(path), "creditos.txt"))
