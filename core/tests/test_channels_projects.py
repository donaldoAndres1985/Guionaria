import json

import pytest


@pytest.fixture
def channel(client):
    resp = client.post(
        "/api/channels",
        json={"name": "Casos Reales", "platforms": ["youtube", "tiktok"], "niche": "crimen"},
    )
    assert resp.status_code == 201
    return resp.json()


def new_project(client, channel_id, **extra):
    body = {"channel_id": channel_id, "title": "El secuestro más largo", "format": "video"}
    return client.post("/api/projects", json=body | extra)


def test_create_channel_creates_folders(client, home, channel):
    assert channel["slug"] == "casos-reales"
    assert channel["platforms"] == ["youtube", "tiktok"]
    assert channel["project_count"] == 0
    assert (home / "channels" / "casos-reales" / "brand").is_dir()
    assert (home / "channels" / "casos-reales" / "projects").is_dir()


def test_channel_slug_is_unique_and_stable(client, channel):
    other = client.post("/api/channels", json={"name": "Casos reales"}).json()
    assert other["slug"] == "casos-reales-2"

    renamed = client.patch(f"/api/channels/{channel['id']}", json={"name": "Otro nombre"}).json()
    assert renamed["name"] == "Otro nombre"
    assert renamed["slug"] == "casos-reales"


def test_channel_validation(client):
    assert client.post("/api/channels", json={"name": ""}).status_code == 422
    assert (
        client.post("/api/channels", json={"name": "X", "platforms": ["myspace"]}).status_code
        == 422
    )


def test_create_project_folder_and_defaults(client, home, channel):
    resp = new_project(client, channel["id"])
    assert resp.status_code == 201
    project = resp.json()
    assert project["status"] == "IDEA"
    assert project["target_duration_s"] == 600
    assert project["channel_name"] == "Casos Reales"

    folder = home / "channels" / "casos-reales" / "projects"
    [project_dir] = list(folder.iterdir())
    assert project_dir.name.endswith("_el-secuestro-mas-largo_video")
    for sub in ("media/approved", "media/candidates", "media/manual", "audio/segments", "subs"):
        assert (project_dir / sub).is_dir()
    snapshot = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
    assert snapshot["title"] == "El secuestro más largo"


def test_reel_default_duration_and_duplicate_folder(client, channel):
    a = new_project(client, channel["id"], format="reel").json()
    b = new_project(client, channel["id"], format="reel").json()
    assert a["target_duration_s"] == 60
    assert a["folder_path"] != b["folder_path"]
    assert b["folder_path"].endswith("-2")


def test_project_requires_existing_channel(client):
    resp = new_project(client, 999)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "El canal no existe"


def test_list_filters_and_search(client, channel):
    other = client.post("/api/channels", json={"name": "Historia"}).json()
    new_project(client, channel["id"], topic="Ciudad de México")
    new_project(client, other["id"], title="La caída de Roma")

    assert len(client.get("/api/projects").json()) == 2
    assert len(client.get(f"/api/projects?channel={other['id']}").json()) == 1
    assert len(client.get("/api/projects?status=IDEA").json()) == 2
    assert len(client.get("/api/projects?status=PUBLICADO").json()) == 0

    hits = client.get("/api/projects", params={"q": "mexi"}).json()
    assert [p["title"] for p in hits] == ["El secuestro más largo"]
    assert client.get("/api/projects", params={"q": "roma"}).json()[0]["channel_name"] == "Historia"


def test_update_project_reindexes_search(client, channel):
    project = new_project(client, channel["id"]).json()
    client.patch(
        f"/api/projects/{project['id']}", json={"title": "Caso Priscila", "tags": ["cdmx"]}
    )
    assert client.get("/api/projects", params={"q": "priscila"}).json()[0]["tags"] == ["cdmx"]
    assert client.get("/api/projects", params={"q": "secuestro"}).json() == []


def test_channel_with_projects_cannot_be_deleted(client, channel):
    new_project(client, channel["id"])
    resp = client.delete(f"/api/channels/{channel['id']}")
    assert resp.status_code == 409
    assert client.get(f"/api/channels/{channel['id']}").json()["project_count"] == 1


def test_delete_project_moves_folder_to_trash(client, home, channel):
    project = new_project(client, channel["id"]).json()
    assert client.delete(f"/api/projects/{project['id']}").status_code == 204
    assert client.get(f"/api/projects/{project['id']}").status_code == 404
    [trashed] = list((home / "trash").iterdir())
    assert trashed.name.endswith("_el-secuestro-mas-largo_video")

    assert client.delete(f"/api/channels/{channel['id']}").status_code == 204
    assert not (home / "channels" / "casos-reales").exists()


def test_operations_are_logged(client, channel):
    new_project(client, channel["id"])
    from sqlmodel import Session, select

    from guionaria_core.db import get_engine
    from guionaria_core.models import OperationLog

    with Session(get_engine()) as s:
        actions = [(o.entity, o.action) for o in s.exec(select(OperationLog)).all()]
    assert actions == [("channel", "create"), ("project", "create")]
