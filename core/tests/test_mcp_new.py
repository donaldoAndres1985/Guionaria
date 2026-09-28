"""Herramientas MCP añadidas: elegir y «descargar y aprobar», tramo, ElevenLabs, render con
calidad y estilo, cancelar."""

import json

import pytest

from guionaria_core.services.render import service as render_svc
from tests.media_support import search
from tests.test_elevenlabs import SETTINGS, eleven  # noqa: F401  (fixture)
from tests.test_mcp import Mcp, ToolFailed, wait


@pytest.fixture
def mcp(client):
    return Mcp(client)


def test_new_tools_are_listed(mcp):
    tools = {t["name"]: t for t in mcp.rpc("tools/list").json()["result"]["tools"]}
    assert {
        "choose_media", "download_and_approve", "set_trim", "list_elevenlabs_voices",
        "cancel_job", "render_video", "generate_voice",
    } <= set(tools)  # fmt: skip
    engine = tools["generate_voice"]["inputSchema"]["properties"]["engine"]
    assert '"enum": ["piper", "elevenlabs"]' in json.dumps(engine)  # opcional: el de Ajustes
    quality = tools["render_video"]["inputSchema"]["properties"]["quality"]
    assert "max" in str(quality)


def test_choose_download_and_trim(client, mcp, media_project, web):
    pid = media_project["id"]
    video, image = media_project["scenes"][:2]
    for scene in (video, image):
        first = search(client, scene).json()["scene"]["candidates"][0]
        chosen = mcp.call("choose_media", scene_id=scene, candidate_ids=[first["id"]])
        assert chosen["scene_id"] == scene
    job = wait(client, mcp.call("download_and_approve", project_id=pid))
    assert job["status"] == "done", job["error"]
    assert job["result"]["approved"] == 2
    [trim] = job["result"]["trim"]  # el video de 12 s en una escena de 2 s
    assert trim["scene_id"] == video

    # Con fondo desenfocado, set_trim cambia el tramo sin tocar el encuadre.
    asset = trim["asset_id"]
    client.put(f"/api/scenes/{video}/assets/{asset}/framing", json={"mode": "blur"})
    out = mcp.call("set_trim", scene_id=video, asset_id=asset, trim_in_s=3.0, trim_out_s=5.0)
    assert (out["trim_in_s"], out["trim_out_s"]) == (3.0, 5.0)
    assert out["scene_duration_s"] == 2.0
    framing = client.get(f"/api/scenes/{video}/assets/{asset}/framing").json()
    assert framing["mode"] == "blur"


def test_elevenlabs_voices_and_generation(client, mcp, media_project, eleven):  # noqa: F811
    data = mcp.call("list_elevenlabs_voices", query="mi")
    assert [v["name"] for v in data["voices"]] == ["Mi voz"]
    assert data["account"]["remaining"] == 8800
    assert data["models"][0]["id"] == "eleven_multilingual_v2"

    job = mcp.call(
        "generate_voice",
        project_id=media_project["id"],
        engine="elevenlabs",
        voice_id=SETTINGS["voice_id"],
        model_id="eleven_turbo_v2_5",
        speed=1.1,
    )
    done = wait(client, job)
    assert done["status"] == "done", done["error"]
    state = client.get(f"/api/projects/{media_project['id']}/voice").json()
    assert state["source"] == "elevenlabs"
    assert state["elevenlabs"]["model_id"] == "eleven_turbo_v2_5"


def test_elevenlabs_needs_a_voice(mcp, media_project, eleven):  # noqa: F811
    with pytest.raises(ToolFailed, match="voice_id"):
        mcp.call("generate_voice", project_id=media_project["id"], engine="elevenlabs")


def test_render_with_quality_and_preset(client, mcp, media_project, monkeypatch):
    calls = {}

    async def fake_render(
        session_factory, project_id, level, burn, ctx, style=None, text_style=None, look=None
    ):
        calls.update(level=level, burn=burn, style=style, text_style=text_style, look=look)
        return {"file": "proyecto.mp4"}

    monkeypatch.setattr(render_svc, "render_project", fake_render)
    job = mcp.call(
        "render_video",
        project_id=media_project["id"],
        quality="max",
        subtitle_preset="reel",
        look_preset="crimen",
    )
    assert wait(client, job)["status"] == "done"
    assert calls["level"] == "max"
    assert (calls["look"].preset, calls["look"].saturation) == ("crimen", 40)
    style = calls["style"]
    assert (style.font, style.italic, style.edge, style.animation) == (
        "Montserrat",
        True,
        "shadow",
        "pop",
    )
    # draft=true sigue funcionando.
    wait(client, mcp.call("render_video", project_id=media_project["id"], draft=True))
    assert calls["level"] == "draft" and calls["style"] is None


def test_cancel_job_errors(mcp, client, media_project, monkeypatch):
    async def fake_render(*args, **kwargs):
        return {}

    monkeypatch.setattr(render_svc, "render_project", fake_render)
    job = mcp.call("render_video", project_id=media_project["id"], quality="draft")
    wait(client, job)
    with pytest.raises(ToolFailed, match="ya terminó"):
        mcp.call("cancel_job", job_id=job["job_id"])
