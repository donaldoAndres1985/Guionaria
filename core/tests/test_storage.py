import httpx

from tests.media_support import downloaded, jpeg_bytes


def find(node, id_):
    if node["id"] == id_:
        return node
    for child in node["children"]:
        if hit := find(child, id_):
            return hit
    return None


def test_usage_tree_counts_hardlinks_once(client, media_project, web, home, channel):
    pid = media_project["id"]
    image = media_project["scenes"][1]
    web.respond(
        "https://images.pexels.com/1.jpeg", httpx.Response(200, content=jpeg_bytes(800, 1200))
    )
    [a, *_] = downloaded(client, image, providers=["pexels"])
    client.post(f"/api/scenes/{image}/assets/{a['id']}:approve", json={"role": "main"})

    usage = client.get("/api/storage/usage").json()
    tree = usage["tree"]
    assert (
        tree["kind"] == "root"
        and usage["disk_free"] > 0
        and usage["disk_total"] >= usage["disk_free"]
    )
    ch = find(tree, f"c{channel['id']}")
    assert (ch["name"], ch["kind"]) == ("Casos Reales", "channel")
    project = find(tree, f"p{pid}")
    assert (project["name"], project["project_id"]) == ("El secuestro", pid)
    parts = {c["id"].split(":")[1]: c for c in project["children"]}
    # La foto aprobada es un enlace duro al candidato: se cuenta en «Candidatos», no dos veces.
    assert parts["candidates"]["bytes"] >= a["size_bytes"]
    assert "approved" not in parts or parts["approved"]["bytes"] == 0
    assert usage["shared_bytes"] >= a["size_bytes"]
    assert "other" in parts  # guion.md, escenas.json, etc.
    # Los totales cuadran de abajo hacia arriba.
    assert project["bytes"] == sum(c["bytes"] for c in project["children"])
    assert tree["bytes"] == sum(c["bytes"] for c in tree["children"])
    assert find(tree, "data")["bytes"] > 0  # la base de datos
    sizes = [c["bytes"] for c in tree["children"]]
    assert sizes == sorted(sizes, reverse=True)


def test_cleanup_unused_candidates(client, media_project, web, home):
    pid = media_project["id"]
    video, image, real, _text = media_project["scenes"]
    assets = downloaded(client, image, providers=["pexels", "pixabay"])
    keep = assets[0]
    client.post(f"/api/scenes/{image}/assets/{keep['id']}:approve", json={"role": "main"})
    unused = [x for x in assets if x["id"] != keep["id"]]
    assert unused

    preview = client.get("/api/storage/cleanup").json()
    [p] = preview["projects"]
    assert (p["project_id"], p["count"], p["media_approved"]) == (pid, len(unused), False)
    assert preview["total_count"] == len(unused)

    result = client.post("/api/storage/cleanup", json={"project_ids": [pid]}).json()
    assert result["deleted"] == len(unused)
    after = client.get(f"/api/scenes/{image}/media").json()
    by_asset = {c["asset"]["id"] for c in after["candidates"] if c["asset"]}
    assert by_asset == {keep["id"]}  # el aprobado sigue
    # Los demás candidatos siguen en la lista, sin archivo, para volver a descargarlos.
    assert {c["download_status"] for c in after["candidates"] if not c["asset"]} == {"none"}
    assert client.get(f"/api/assets/{unused[0]['id']}/file").status_code == 404
    assert client.get(f"/api/assets/{keep['id']}/file").status_code == 200
    assert client.get("/api/storage/cleanup").json()["projects"] == []

    assert client.post("/api/storage/cleanup", json={"project_ids": []}).status_code == 422
    assert client.post("/api/storage/cleanup", json={"project_ids": [999]}).status_code == 404


def test_cleanup_frees_only_unshared_files(client, media_project, web, home):
    """Dos candidatos con el mismo contenido (enlace duro): el espacio se libera al borrar
    el último, no dos veces."""
    pid = media_project["id"]
    image, real = media_project["scenes"][1], media_project["scenes"][2]
    [a1, *_] = downloaded(client, image, providers=["pexels"])
    [a2, *_] = downloaded(client, real, providers=["wikimedia"])  # mismo contenido simulado
    result = client.post("/api/storage/cleanup", json={"project_ids": [pid]}).json()
    assert result["deleted"] >= 2
    assert result["freed_bytes"] >= a1["size_bytes"]
    assert result["freed_bytes"] < a1["size_bytes"] + a2["size_bytes"] + 100_000
