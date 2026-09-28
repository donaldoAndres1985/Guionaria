"""Vista previa en vivo del timeline: la receta que la app compone sin renderizar."""

from tests.conftest import wait_job
from tests.media_support import downloaded
from tests.test_voice import engines_fake  # noqa: F401  (fixture)


def test_preview_recipe(client, media_project, web, engines_fake):  # noqa: F811
    pid = media_project["id"]
    video, image, real, _text = media_project["scenes"]
    for scene in (video, image, real):
        [a, *_] = downloaded(client, scene)
        client.post(f"/api/scenes/{scene}/assets/{a['id']}:approve")
    assert client.post(f"/api/projects/{pid}/media:approve").status_code == 200
    job = wait_job(client, client.post(f"/api/projects/{pid}/voice:generate", json={}).json()["id"])
    assert job["status"] == "done", job["error"]

    data = client.get(f"/api/projects/{pid}/timeline/preview").json()
    assert (data["width"], data["height"], data["fps"]) == (1080, 1920, 30)
    assert data["duration_s"] == 4.9
    first, photo, _real, text = data["scenes"]
    assert first["media"]["kind"] == "video"
    assert "/approved-file?v=" in first["media"]["url"]
    assert client.get(first["media"]["url"]).status_code == 200
    assert photo["media"]["kind"] == "image"
    assert text["media"] is None and text["text"] == "SIN RESPUESTA"
    assert [s["start_s"] for s in data["scenes"]] == [0.0, 1.3, 2.6, 3.9]
    assert data["voice_url"].startswith(f"/api/projects/{pid}/voice/audio?v=")
    assert client.get(data["voice_url"]).status_code == 200
    # Piper: 16 palabras con tiempos estimados, dentro de su segmento.
    assert len(data["words"]) == 16
    assert data["words"][0] == {"text": "Uno", "start": 0.0, "end": data["words"][1]["start"]}
    assert data["words"][4]["start"] == 1.3
    assert data["subtitle_style"]["highlight"] is True
    assert data["default_burn_subtitles"] is True
    assert data["sfx"] == [] and data["music"] == []


def test_preview_without_voice_or_media(client, media_project):
    data = client.get(f"/api/projects/{media_project['id']}/timeline/preview").json()
    assert data["voice_url"] is None
    assert data["words"] == []
    assert all(s["media"] is None for s in data["scenes"])


def test_new_voice_changes_the_preview_url(client, media_project, web, engines_fake):  # noqa: F811
    """Al generar otra voz la URL cambia: el navegador no reproduce la vieja desde su caché."""
    import time

    pid = media_project["id"]
    video, image, real, _text = media_project["scenes"]
    for scene in (video, image, real):
        [a, *_] = downloaded(client, scene)
        client.post(f"/api/scenes/{scene}/assets/{a['id']}:approve")
    client.post(f"/api/projects/{pid}/media:approve")
    wait_job(client, client.post(f"/api/projects/{pid}/voice:generate", json={}).json()["id"])
    before = client.get(f"/api/projects/{pid}/timeline/preview").json()["voice_url"]
    time.sleep(0.05)
    wait_job(
        client, client.post(f"/api/projects/{pid}/voice:generate", json={"speed": 1.2}).json()["id"]
    )
    after = client.get(f"/api/projects/{pid}/timeline/preview").json()["voice_url"]
    assert before != after
