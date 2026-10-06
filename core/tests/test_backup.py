"""Copia de seguridad del video final y la portada, y limpieza que conserva la portada."""

import pytest

from guionaria_core.config import load_settings, save_settings
from guionaria_core.services import storage


def project_folder(home):
    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    return folder


def fake_render(home):
    """Un render terminado: el video final, su miniatura y el borrador."""
    render = project_folder(home) / "render"
    render.mkdir(parents=True, exist_ok=True)
    (render / "el-secuestro.mp4").write_bytes(b"v" * 4000)
    (render / "el-secuestro_borrador.mp4").write_bytes(b"d" * 1000)
    (render / "miniatura.jpg").write_bytes(b"\xff\xd8portada")
    return render


def set_backup(folder, before_cleanup=True):
    settings = load_settings()
    settings.backup.folder = str(folder)
    settings.backup.before_cleanup = before_cleanup
    save_settings(settings)


@pytest.fixture(autouse=True)
def no_synced_folders(monkeypatch):
    """Las pruebas no dependen de las unidades del equipo (Google Drive, OneDrive…)."""
    monkeypatch.setattr(storage, "backup_suggestions", lambda: [])


def test_cleanup_render_keeps_cover(client, project, home):
    render = fake_render(home)
    r = client.post(
        "/api/storage/cleanup/media", json={"project_ids": [project["id"]], "parts": ["render"]}
    ).json()
    assert r["deleted"] == 2  # los dos videos; la portada no se cuenta ni se borra
    assert [p.name for p in render.iterdir()] == ["miniatura.jpg"]
    listed = client.get("/api/projects").json()
    [p] = [x for x in listed if x["id"] == project["id"]]
    assert p["cover_url"].startswith(f"/api/projects/{project['id']}/cover")
    assert client.get(p["cover_url"]).status_code == 200
    [entry] = [i for i in client.get("/api/history").json()["items"] if i["action"] == "cleanup"]
    assert entry["text"] == "Limpieza: render borrados"


def test_cleanup_audio_removes_whole_folder(client, project, home):
    audio = project_folder(home) / "audio" / "sub"
    audio.mkdir(parents=True)
    (audio / "voz.wav").write_bytes(b"a" * 10)
    client.post(
        "/api/storage/cleanup/media", json={"project_ids": [project["id"]], "parts": ["audio"]}
    )
    assert not (project_folder(home) / "audio").exists()


def test_backup_status(client, tmp_path):
    empty = client.get("/api/storage/backup").json()
    assert (empty["folder"], empty["ok"]) == ("", False)

    target = tmp_path / "Drive" / "Guionaria"
    (tmp_path / "Drive").mkdir()
    probe = client.get("/api/storage/backup", params={"folder": str(target)}).json()
    assert probe["ok"] is True and probe["free_bytes"] > 0
    assert target.is_dir()  # se crea si la carpeta de arriba existe
    assert not any(target.iterdir())  # sin restos de la prueba de escritura

    missing = client.get(
        "/api/storage/backup", params={"folder": str(tmp_path / "X" / "Y" / "Z")}
    ).json()
    assert missing["ok"] is False and "¿está conectada la unidad" in missing["detail"]
    relative = client.get("/api/storage/backup", params={"folder": "carpeta"}).json()
    assert "ruta completa" in relative["detail"]


def test_backup_copies_video_and_cover(client, project, home, tmp_path):
    fake_render(home)
    target = tmp_path / "Drive"
    target.mkdir()
    set_backup(target)

    r = client.post("/api/storage/backup", json={"project_ids": [project["id"]]}).json()
    dest = target / "casos-reales" / project_folder(home).name
    assert r["copied"] == 2 and r["bytes"] == 4000 + len(b"\xff\xd8portada")
    assert sorted(p.name for p in dest.iterdir()) == ["el-secuestro.mp4", "portada.jpg"]
    assert r["items"][0]["folder"] == str(dest)

    again = client.post("/api/storage/backup", json={"project_ids": [project["id"]]}).json()
    assert again["copied"] == 0  # ya estaba igual: no se vuelve a copiar
    assert any(i["action"] == "backup" for i in client.get("/api/history").json()["items"])


def test_cleanup_with_backup(client, project, home, tmp_path):
    render = fake_render(home)
    target = tmp_path / "Drive"
    target.mkdir()
    set_backup(target)
    client.post(
        "/api/storage/cleanup/media",
        json={"project_ids": [project["id"]], "parts": ["render"], "backup": True},
    )
    dest = target / "casos-reales" / project_folder(home).name
    assert (dest / "el-secuestro.mp4").read_bytes() == b"v" * 4000
    assert not (render / "el-secuestro.mp4").exists()


def test_cleanup_with_backup_unavailable_deletes_nothing(client, project, home, tmp_path):
    render = fake_render(home)
    set_backup(tmp_path / "unidad-desconectada" / "Guionaria")
    resp = client.post(
        "/api/storage/cleanup/media",
        json={"project_ids": [project["id"]], "parts": ["render"], "backup": True},
    )
    assert resp.status_code >= 400
    assert (render / "el-secuestro.mp4").exists()

    set_backup("")
    resp = client.post("/api/storage/backup", json={"project_ids": [project["id"]]})
    assert "Ajustes → Carpetas" in resp.json()["detail"]


def test_project_list_skips_missing_media_thumbs(client, media_project, web, home):
    from tests.test_framing import approve

    approve(client, media_project["scenes"][1])
    [p] = [x for x in client.get("/api/projects").json() if x["id"] == media_project["id"]]
    assert len(p["media_thumbs"]) == 1
    for thumb in project_folder(home).rglob(".thumbs/*.jpg"):
        thumb.unlink()
    [p] = [x for x in client.get("/api/projects").json() if x["id"] == media_project["id"]]
    assert p["media_thumbs"] == [] and p["media_count"] == 1


def test_publishing_state_has_render_dir(client, project, home):
    state = client.get(f"/api/projects/{project['id']}/publishing").json()
    assert state["render_dir"] == str(project_folder(home) / "render")


def test_usage_counts_cover_outside_render(client, project, home):
    fake_render(home)
    usage = client.get("/api/storage/usage").json()
    [channel] = [c for c in usage["tree"]["children"] if c["kind"] == "channel"]
    [proj] = channel["children"]
    parts = {c["id"].split(":")[1]: c for c in proj["children"]}
    assert (parts["render"]["files"], parts["render"]["bytes"]) == (2, 5000)  # solo los videos
    assert parts["other"]["files"] >= 1
