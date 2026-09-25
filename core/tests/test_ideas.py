from tests.test_mcp import Mcp


def idea(client, channel, **over):
    body = {
        "channel_id": channel["id"],
        "title": "El caso del faro",
        "notes": "Fuente: archivo",
        **over,
    }
    resp = client.post("/api/ideas", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_crud_and_order(client, channel):
    a = idea(client, channel, title="Baja", priority=3)
    b = idea(client, channel, title="  Alta  ", priority=1, notes="   ")
    c = idea(client, channel, title="Media")
    assert (b["title"], b["notes"], b["status"]) == ("Alta", None, "open")
    assert [i["title"] for i in client.get("/api/ideas").json()] == ["Alta", "Media", "Baja"]

    updated = client.patch(f"/api/ideas/{a['id']}", json={"priority": 1, "notes": "nueva"}).json()
    assert (updated["priority"], updated["notes"]) == (1, "nueva")
    client.patch(f"/api/ideas/{c['id']}", json={"status": "discarded"})
    # misma prioridad: la más reciente primero
    assert [i["title"] for i in client.get("/api/ideas?status=open").json()] == ["Alta", "Baja"]
    assert [i["title"] for i in client.get("/api/ideas?q=med").json()] == ["Media"]
    assert client.get(f"/api/ideas?channel={channel['id'] + 1}").json() == []

    assert client.delete(f"/api/ideas/{a['id']}").status_code == 204
    assert client.patch(f"/api/ideas/{a['id']}", json={"title": "x"}).status_code == 404
    assert client.post("/api/ideas", json={"channel_id": 999, "title": "x"}).status_code == 404
    assert (
        client.post("/api/ideas", json={"channel_id": channel["id"], "title": ""}).status_code
        == 422
    )


def test_convert_to_project_and_release_on_delete(client, channel):
    i = idea(client, channel, priority=1)
    project = client.post(
        f"/api/ideas/{i['id']}:convert",
        json={"format": "reel", "target_duration_s": 45, "target_publish_at": "2026-10-03"},
    ).json()
    assert (project["title"], project["topic"], project["research_notes"]) == (
        "El caso del faro",
        "El caso del faro",
        "Fuente: archivo",
    )
    assert (project["format"], project["target_publish_at"], project["priority"]) == (
        "reel",
        "2026-10-03",
        1,
    )
    converted = client.get("/api/ideas").json()[0]
    assert (converted["status"], converted["project_id"]) == ("converted", project["id"])

    again = client.post(f"/api/ideas/{i['id']}:convert", json={"format": "reel"})
    assert again.status_code == 409
    locked = client.patch(f"/api/ideas/{i['id']}", json={"status": "discarded"})
    assert locked.json()["detail"] == "La idea ya es un proyecto: edítalo desde Proyectos"

    # Si se borra el proyecto, la idea vuelve a estar abierta.
    assert client.delete(f"/api/projects/{project['id']}").status_code == 204
    reopened = client.get("/api/ideas").json()[0]
    assert (reopened["status"], reopened["project_id"]) == ("open", None)


def test_delete_channel_removes_its_ideas(client, channel):
    idea(client, channel)
    assert client.delete(f"/api/channels/{channel['id']}").status_code == 204
    assert client.get("/api/ideas").json() == []


def test_manual_status_only_for_final_stages(client, project):
    pid = project["id"]
    resp = client.post(f"/api/projects/{pid}:set-status", json={"status": "PUBLICADO"})
    assert resp.status_code == 409
    assert (
        resp.json()["detail"] == "El proyecto avanza aprobando cada etapa hasta tener el timeline"
    )

    from sqlmodel import Session

    from guionaria_core.db import get_engine
    from guionaria_core.models import Project

    with Session(get_engine()) as s:
        s.get(Project, pid).status = "TIMELINE_LISTO"
        s.commit()
    assert (
        client.post(f"/api/projects/{pid}:set-status", json={"status": "PROGRAMADO"}).json()[
            "status"
        ]
        == "PROGRAMADO"
    )
    assert (
        client.post(
            f"/api/projects/{pid}:set-status", json={"status": "TIMELINE_LISTO"}
        ).status_code
        == 200
    )
    back = client.post(f"/api/projects/{pid}:set-status", json={"status": "MEDIOS_APROBADOS"})
    assert back.status_code == 409


def test_ideas_by_mcp(client, channel):
    mcp = Mcp(client)
    created = mcp.call(
        "add_ideas",
        channel="Casos Reales",
        items=[{"title": "Idea uno", "priority": 1}, {"title": "Idea dos", "notes": "n"}],
    )
    assert len(created["idea_ids"]) == 2
    listed = mcp.call("list_ideas", channel="casos-reales")["ideas"]
    assert [i["title"] for i in listed] == ["Idea uno", "Idea dos"]
    project = mcp.call("convert_idea", idea_id=created["idea_ids"][0], format="video")
    assert project["status"] == "IDEA"
    assert [i["title"] for i in mcp.call("list_ideas")["ideas"]] == ["Idea dos"]
