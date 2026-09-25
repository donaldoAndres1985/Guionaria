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


def test_dependency_check_works_on_selector_loop(home):
    # uvicorn --reload usa SelectorEventLoop en Windows (sin soporte de subprocesos asyncio).
    import asyncio

    from guionaria_core.services.dependencies import check_dependencies

    loop = asyncio.SelectorEventLoop()
    try:
        deps = loop.run_until_complete(check_dependencies(refresh=True))
    finally:
        loop.close()
    assert any(d.name == "claude" for d in deps)


def test_core_exits_when_parent_dies(tmp_path):
    import subprocess
    import sys

    env = {**__import__("os").environ, "GUIONARIA_HOME": str(tmp_path / "h")}
    parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    child = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import sys, time; from guionaria_core.watchdog import exit_when_parent_dies;"
            f"exit_when_parent_dies({parent.pid}); time.sleep(60); sys.exit(1)",
        ],
        env=env,
    )
    try:
        parent.kill()
        assert child.wait(timeout=10) == 0
    finally:
        child.kill()
        parent.kill()
