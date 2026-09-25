def test_health_reports_db_and_dependencies(client, home):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db_ok"] is True
    assert body["home"] == str(home.resolve())
    names = {d["name"] for d in body["dependencies"]}
    assert {"ffmpeg", "ffprobe", "yt-dlp", "claude", "docker", "searxng"} <= names
    for dep in body["dependencies"]:
        assert dep["install_hint"]


def test_startup_creates_home_tree(client, home):
    for rel in ("guionaria.db", "config/prompts", "channels", "library/sfx", "library/music"):
        assert (home / rel).exists(), rel


def test_settings_roundtrip(client, home):
    settings = client.get("/api/settings").json()
    assert settings["download_parallelism"] == 4

    settings["api_keys"]["pexels"] = "abc123"
    settings["download_parallelism"] = 6
    assert client.put("/api/settings", json=settings).status_code == 200

    assert client.get("/api/settings").json()["api_keys"]["pexels"] == "abc123"
    assert (home / "config" / "settings.json").exists()


def test_settings_rejects_invalid_parallelism(client):
    settings = client.get("/api/settings").json()
    settings["download_parallelism"] = 0
    assert client.put("/api/settings", json=settings).status_code == 422
