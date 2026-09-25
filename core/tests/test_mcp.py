"""Servidor MCP: el flujo completo por HTTP (JSON-RPC), como lo usa Claude Code."""

import json

import pytest
from sqlmodel import Session, select

from tests.conftest import wait_job
from tests.media_support import ESCENAS, GUION, set_keys
from tests.test_voice import engines_fake, write_wav  # noqa: F401  (fixture)

HEADERS = {"Accept": "application/json, text/event-stream", "Host": "127.0.0.1:8765"}


class Mcp:
    def __init__(self, client):
        self.client = client
        self.next_id = 0

    def rpc(self, method, params=None, headers=None):
        self.next_id += 1
        resp = self.client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params or {}},
            headers={**HEADERS, **(headers or {})},
        )
        return resp

    def call(self, name, **arguments):
        body = self.rpc("tools/call", {"name": name, "arguments": arguments}).json()
        result = body["result"]
        if result.get("isError"):
            raise ToolFailed(result["content"][0]["text"])
        if "structuredContent" in result:
            data = result["structuredContent"]
            return data["result"] if set(data) == {"result"} else data
        return result["content"][0]["text"]

    def read(self, uri):
        body = self.rpc("resources/read", {"uri": uri}).json()
        return body["result"]["contents"][0]["text"]


class ToolFailed(Exception):
    pass


@pytest.fixture
def mcp(client):
    return Mcp(client)


def segments_from(guion):
    return [{"section": s["seccion"], "text": s["texto"]} for s in guion["segmentos"]]


def wait(client, job):
    return wait_job(client, job["job_id"])


def test_initialize_and_list_tools(mcp):
    init = mcp.rpc(
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "prueba", "version": "1"},
        },
    ).json()["result"]
    assert "guion → escenas → medios → voz → timeline" in init["instructions"]
    tools = {t["name"]: t for t in mcp.rpc("tools/list").json()["result"]["tools"]}
    expected = {
        "list_channels", "create_project", "list_projects", "get_project", "save_script",
        "get_script", "update_segment", "approve_script", "save_scenes", "update_scene",
        "approve_scenes", "search_media", "select_candidates", "approve_media", "list_pending",
        "add_media_from_url", "generate_voice", "transcribe_voice", "export_timeline",
        "get_credits", "job_status",
    }  # fmt: skip
    assert expected <= set(tools)  # sección 12, más approve_all_media e import_voice
    assert "zoom_lento_in" in tools["save_scenes"]["description"]
    speed = tools["generate_voice"]["inputSchema"]["properties"]["speed"]
    assert (speed["minimum"], speed["maximum"]) == (0.7, 1.4)
    templates = mcp.rpc("resources/templates/list").json()["result"]["resourceTemplates"]
    assert {t["uriTemplate"] for t in templates} == {
        "guionaria://project/{project_id}/script",
        "guionaria://project/{project_id}/scenes",
        "guionaria://channel/{slug}/style",
    }


def test_only_localhost_hosts(mcp):
    resp = mcp.rpc("tools/list", headers={"Host": "evil.example"})
    assert resp.status_code == 421


def test_full_flow_without_calling_claude(
    client,
    mcp,
    channel,
    web,
    fake_claude,
    engines_fake,  # noqa: F811
    home,
):
    set_keys(client)
    # Canales y proyecto: el canal se nombra como lo diría el usuario.
    [ch] = mcp.call("list_channels")["channels"]
    assert ch["name"] == "Casos Reales"
    created = mcp.call(
        "create_project",
        channel="casos reales",
        title="El caso",
        format="reel",
        topic="Caso Priscila",
        notes="Ocurrió en 2008.",
        target_duration_s=45,
    )
    pid = created["project_id"]
    assert mcp.call("list_projects", channel="casos-reales")["projects"][0]["project_id"] == pid
    assert mcp.call("get_project", project_id=pid)["next_step"].startswith("Redacta el guion")

    # Guion redactado por Claude (fuera de la app) y guardado tal cual.
    script = mcp.call("save_script", project_id=pid, segments=segments_from(GUION))
    assert [s["seg_key"] for s in script["segments"]] == [
        "seg_001",
        "seg_002",
        "seg_003",
        "seg_004",
    ]
    assert script["source"] == "mcp"
    changed = mcp.call("update_segment", project_id=pid, seg_key="seg_002", text="Otro texto.")
    assert changed == {"script_version": 2, "scenes_to_review": []}
    assert mcp.call("get_script", project_id=pid)["segments"][1]["text"] == "Otro texto."
    assert mcp.call("approve_script", project_id=pid) == {"ok": True, "version": 2}
    assert "**seg_002** (contexto" in mcp.read(f"guionaria://project/{pid}/script")

    # Escenas: se validan con las mismas reglas que las generadas por la app.
    bad = [{**ESCENAS["escenas"][0], "busqueda_en": ""}, *ESCENAS["escenas"][1:]]
    with pytest.raises(ToolFailed, match="busqueda_en es obligatoria"):
        mcp.call("save_scenes", project_id=pid, scenes=bad)
    saved = mcp.call("save_scenes", project_id=pid, scenes=ESCENAS["escenas"])
    assert saved["count"] == 4
    scene_ids = [s["scene_id"] for s in saved["scenes"]]
    updated = mcp.call("update_scene", scene_id=scene_ids[0], fields={"effect": "ken_burns"})
    assert updated["effect"] == "ken_burns"
    assert mcp.call("approve_scenes", project_id=pid) == {"ok": True, "scenes": 4}
    assert "SIN RESPUESTA" in mcp.read(f"guionaria://project/{pid}/scenes")

    # Medios: buscar, descargar (job), aprobar.
    pending = mcp.call("list_pending", project_id=pid)["pending"]
    assert [p["media_kind"] for p in pending] == ["video", "image", "real"]
    for scene in pending[:2]:
        found = mcp.call("search_media", scene_id=scene["scene_id"], provider="pexels")
        first = found["candidates"][0]
        job = mcp.call(
            "select_candidates", scene_id=scene["scene_id"], candidate_ids=[first["candidate_id"]]
        )
        assert wait(client, job)["status"] == "done"
        status = mcp.call("job_status", job_id=job["job_id"])
        assert status["result"]["downloaded"] == 1
        [again] = [
            c
            for c in mcp.call("search_media", scene_id=scene["scene_id"], provider="pexels")[
                "candidates"
            ]
            if c["candidate_id"] == first["candidate_id"]
        ]
        approved = mcp.call("approve_media", scene_id=scene["scene_id"], asset_id=again["asset_id"])
        assert approved["approved"][0]["role"] == "main"
    # La escena de material real con una imagen directa desde una URL.
    real = pending[2]["scene_id"]
    added = mcp.call("add_media_from_url", scene_id=real, url="https://example.org/foto.jpg")
    assert added["status"] == "approved"  # lo agregado a mano queda aprobado
    with pytest.raises(ToolFailed, match="El proyecto no existe"):
        mcp.call("approve_all_media", project_id=999)
    assert mcp.call("approve_all_media", project_id=pid)["ok"] is True
    assert mcp.call("list_pending", project_id=pid) == {"pending": []}
    assert "Pexels" in mcp.call("get_credits", project_id=pid)

    # Voz y timeline.
    job = mcp.call("generate_voice", project_id=pid, speed=1.0)
    assert wait(client, job)["status"] == "done"
    project = mcp.call("get_project", project_id=pid)
    assert project["project"]["status"] == "VOZ_LISTA"
    assert project["voice"]["timing_source"] == "voice"
    assert project["next_step"] == "Exporta el timeline con export_timeline."
    exported = mcp.call("export_timeline", project_id=pid, format="otio")
    assert exported["files"][0].endswith("proyecto.otio")
    assert mcp.call("get_project", project_id=pid)["project"]["status"] == "TIMELINE_LISTO"

    # Nunca se llamó a la CLI de Claude y los cambios quedan en el historial como MCP.
    assert fake_claude.calls == []
    from guionaria_core.db import get_engine
    from guionaria_core.models import OperationLog

    with Session(get_engine()) as s:
        actors = {(o.action, o.entity): o.actor for o in s.exec(select(OperationLog))}
    assert actors[("approve", "script")] == "mcp"
    assert actors[("save", "scenes")] == "mcp"
    assert actors[("export", "timeline")] == "mcp"


def test_recorded_voice_by_path(client, mcp, media_project, engines_fake, tmp_path):  # noqa: F811
    pid = media_project["id"]
    wav = tmp_path / "grabacion.wav"
    write_wav(wav, 3.0)
    assert mcp.call("import_voice", project_id=pid, path=str(wav)) == {
        "source": "recorded",
        "duration_s": 3.0,
    }
    assert wav.exists()  # se trabaja con una copia
    with pytest.raises(ToolFailed, match="No existe el archivo"):
        mcp.call("import_voice", project_id=pid, path=str(tmp_path / "nada.wav"))
    from guionaria_core.services.voice.align import Word

    engines_fake["transcriber"].words = [Word("Uno", 0, 0.5)]
    job = mcp.call("transcribe_voice", project_id=pid)
    assert wait(client, job)["status"] == "done"


def test_errors_and_style_resource(client, mcp, channel):
    client.patch(f"/api/channels/{channel['id']}", json={"style_prompt": "Sobrio, sin morbo."})
    style = mcp.read("guionaria://channel/casos-reales/style")
    assert style.startswith("# Casos Reales") and "Sobrio, sin morbo." in style
    with pytest.raises(ToolFailed, match="No existe el canal «otro»"):
        mcp.call("create_project", channel="otro", title="x", format="reel")
    with pytest.raises(ToolFailed, match="El proyecto no existe"):
        mcp.call("get_project", project_id=123)
    with pytest.raises(ToolFailed):
        mcp.call("generate_voice", project_id=1, speed=3)  # fuera de rango


def test_video_site_url_goes_to_yt_dlp(client, mcp, media_project, monkeypatch):
    from guionaria_core.services.media import video_url

    calls = []

    async def fake_download(session_factory, scene_id, url, start_s, end_s, ctx):
        calls.append((scene_id, url, start_s, end_s))
        return {"title": "clip"}

    monkeypatch.setattr(video_url, "download_video_url", fake_download)
    scene = media_project["scenes"][0]
    job = mcp.call(
        "add_media_from_url",
        scene_id=scene,
        url="https://www.youtube.com/watch?v=abc",
        start_s=5,
        end_s=9,
    )
    assert job["type"] == "download_url"
    assert wait(client, job)["result"] == {"title": "clip"}
    assert calls == [(scene, "https://www.youtube.com/watch?v=abc", 5, 9)]


def test_structured_content_is_json_text_too(mcp, channel):
    body = mcp.rpc("tools/call", {"name": "list_channels", "arguments": {}}).json()["result"]
    assert json.loads(body["content"][0]["text"])["channels"][0]["name"] == "Casos Reales"


def test_stdio_entrypoint(tmp_path):
    """`guionaria-core mcp`: stdout solo lleva mensajes JSON-RPC (lo que Claude Desktop lee)."""
    import os
    import subprocess
    import sys

    messages = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "prueba", "version": "1"},
            },
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
         "params": {"name": "list_channels", "arguments": {}}},
    ]  # fmt: skip
    proc = subprocess.Popen(
        [sys.executable, "-m", "guionaria_core", "mcp"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        env={**os.environ, "GUIONARIA_HOME": str(tmp_path / "home")},
    )
    lines = []
    try:
        # Se mantiene stdin abierto hasta recibir las respuestas: al cerrarlo el servidor termina.
        for message in messages:
            proc.stdin.write(json.dumps(message) + "\n")
            proc.stdin.flush()
            if "id" in message:
                lines.append(json.loads(proc.stdout.readline()))
    finally:
        proc.stdin.close()
        proc.wait(timeout=30)
    assert [m["id"] for m in lines] == [1, 2]
    assert lines[0]["result"]["serverInfo"]["name"] == "guionaria"
    assert lines[1]["result"]["structuredContent"] == {"channels": []}
    assert (tmp_path / "home" / "guionaria.db").exists()  # migraciones aplicadas


# --- Ajustes: conectar Claude ---


class FakeCli:
    def __init__(self, registered=False, add_ok=True):
        self.registered = registered
        self.add_ok = add_ok
        self.calls = []

    def __call__(self, args):
        import subprocess

        self.calls.append(args[1:])
        if args[1:3] == ["mcp", "get"]:
            return subprocess.CompletedProcess(args, 0 if self.registered else 1, "", "")
        if self.add_ok:
            self.registered = True
            return subprocess.CompletedProcess(args, 0, "Added", "")
        return subprocess.CompletedProcess(args, 1, "", "error\nMCP server guionaria ya existe")


@pytest.fixture
def cli(monkeypatch):
    from guionaria_core.services import mcp_setup

    fake = FakeCli()
    monkeypatch.setattr(mcp_setup, "runner", fake)
    monkeypatch.setattr(mcp_setup.shutil, "which", lambda name: "C:/bin/claude.exe")
    return fake


def test_mcp_info_and_register(client, cli):
    info = client.get("/api/integrations/mcp").json()
    assert info["http_url"] == "http://127.0.0.1:8765/mcp"
    assert info["claude_code_command"] == (
        "claude mcp add --transport http --scope user guionaria http://127.0.0.1:8765/mcp"
    )
    desktop = json.loads(info["desktop_config"])["mcpServers"]["guionaria"]
    assert desktop["args"][-1] == "mcp"
    assert (info["claude_code_available"], info["claude_code_registered"]) == (True, False)

    info = client.post("/api/integrations/mcp:register-claude-code").json()
    assert info["claude_code_registered"] is True
    assert ["mcp", "add", "--transport", "http", "--scope", "user", "guionaria",
            "http://127.0.0.1:8765/mcp"] in cli.calls  # fmt: skip
    # Ya registrado: no se vuelve a agregar.
    cli.calls.clear()
    client.post("/api/integrations/mcp:register-claude-code")
    assert not any(c[:2] == ["mcp", "add"] for c in cli.calls)


def test_register_errors(client, cli, monkeypatch):
    from guionaria_core.services import mcp_setup

    cli.add_ok = False
    resp = client.post("/api/integrations/mcp:register-claude-code")
    assert resp.status_code == 400
    assert resp.json()["detail"].endswith("MCP server guionaria ya existe")

    monkeypatch.setattr(mcp_setup.shutil, "which", lambda name: None)
    info = client.get("/api/integrations/mcp").json()
    assert (info["claude_code_available"], info["claude_code_registered"]) == (False, None)
    assert client.post("/api/integrations/mcp:register-claude-code").status_code == 400
