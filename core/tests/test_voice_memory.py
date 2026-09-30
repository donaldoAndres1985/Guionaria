"""Memoria de voces: ajustes guardados por voz de ElevenLabs y la voz de cada canal."""

import json

from guionaria_core.config import ElevenLabsPrefs
from guionaria_core.services.voice import memory
from tests.test_elevenlabs import (
    SETTINGS,
    eleven,  # noqa: F401  (fixture)
    generate,
)
from tests.test_mcp import Mcp, wait


def new_project(client, channel_id, title="Otro caso"):
    resp = client.post(
        "/api/projects", json={"channel_id": channel_id, "title": title, "format": "reel"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def channel_of(client, project):
    return client.get(f"/api/projects/{project['id']}").json()["channel_id"]


def voice_of(client, pid):
    return client.get(f"/api/projects/{pid}/voice").json()


def tts_bodies(fake):
    return [json.loads(r.content) for r in fake.requests if "text-to-speech" in r.url.path]


def test_generation_is_remembered_for_the_voice_and_the_channel(
    client,
    media_project,
    eleven,  # noqa: F811
    home,
):
    pid = media_project["id"]
    body = {**SETTINGS, "voice_name": "Mi voz", "style": 0.3}
    assert generate(client, pid, engine="elevenlabs", elevenlabs=body)["status"] == "done"

    saved = json.loads((home / "config" / "voces.json").read_text(encoding="utf-8"))
    assert saved["voices"]["v-mine"]["stability"] == 0.4
    assert saved["voices"]["v-mine"]["voice_name"] == "Mi voz"
    channel_id = channel_of(client, media_project)
    assert saved["channels"][str(channel_id)]["engine"] == "elevenlabs"

    # Un proyecto nuevo del mismo canal abre con esa voz y esos ajustes.
    state = voice_of(client, new_project(client, channel_id)["id"])
    assert state["default_engine"] == "elevenlabs"
    prefs = state["elevenlabs"]
    assert (prefs["voice_id"], prefs["voice_name"]) == ("v-mine", "Mi voz")
    assert (prefs["model_id"], prefs["stability"], prefs["style"], prefs["speed"]) == (
        "eleven_turbo_v2_5",
        0.4,
        0.3,
        1.1,
    )
    assert state["elevenlabs_presets"]["v-mine"]["style"] == 0.3


def test_each_channel_keeps_its_own_voice(client, media_project, eleven):  # noqa: F811
    pid = media_project["id"]
    generate(client, pid, engine="elevenlabs", elevenlabs=SETTINGS)
    other = client.post("/api/channels", json={"name": "Versículos", "platforms": ["youtube"]})
    other_id = other.json()["id"]
    memory.remember_generation(
        other_id,
        "elevenlabs",
        "v-pre",
        ElevenLabsPrefs(voice_id="v-pre", voice_name="Adam", stability=0.8, speed=0.9),
    )
    there = voice_of(client, new_project(client, other_id, "Salmo 23")["id"])["elevenlabs"]
    assert (there["voice_id"], there["stability"], there["speed"]) == ("v-pre", 0.8, 0.9)
    same_channel = new_project(client, channel_of(client, media_project))
    here = voice_of(client, same_channel["id"])["elevenlabs"]
    assert here["voice_id"] == "v-mine"

    # El proyecto que ya tiene voz muestra los ajustes con que se generó.
    assert voice_of(client, pid)["elevenlabs"]["model_id"] == "eleven_turbo_v2_5"


def test_changed_settings_are_saved_for_the_voice(client, media_project, eleven):  # noqa: F811
    pid = media_project["id"]
    generate(client, pid, engine="elevenlabs", elevenlabs=SETTINGS)
    resp = client.put(
        "/api/voice/elevenlabs/presets/v-mine",
        json={"model_id": "eleven_multilingual_v2", "stability": 0.25, "speed": 0.95},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["v-mine"]["stability"] == 0.25
    assert resp.json()["v-mine"]["voice_name"] == ""  # no se inventa un nombre
    bad = client.put("/api/voice/elevenlabs/presets/v-mine", json={"stability": 3})
    assert bad.status_code == 422

    # Sin ajustes explícitos se genera con los guardados de la voz del canal.
    eleven.requests.clear()
    assert generate(client, pid)["status"] == "done"
    first = tts_bodies(eleven)[0]
    assert first["model_id"] == "eleven_multilingual_v2"
    assert first["voice_settings"]["stability"] == 0.25
    assert first["voice_settings"]["speed"] == 0.95


def test_mcp_uses_the_remembered_settings(client, media_project, eleven):  # noqa: F811
    pid = media_project["id"]
    client.put(
        "/api/voice/elevenlabs/presets/v-mine",
        json={"voice_name": "Mi voz", "stability": 0.35, "similarity_boost": 0.9, "style": 0.4},
    )
    mcp = Mcp(client)
    job = mcp.call("generate_voice", project_id=pid, engine="elevenlabs", voice_id="v-mine")
    assert wait(client, job)["status"] == "done"
    settings = tts_bodies(eleven)[0]["voice_settings"]
    assert (settings["stability"], settings["similarity_boost"], settings["style"]) == (
        0.35,
        0.9,
        0.4,
    )

    # Otra vez sin voice_id: la voz del canal; un ajuste explícito manda sobre el guardado.
    eleven.requests.clear()
    job = mcp.call("generate_voice", project_id=pid, engine="elevenlabs", stability=0.7)
    assert wait(client, job)["status"] == "done"
    body = tts_bodies(eleven)[0]
    assert "/v-mine/" in [r.url.path for r in eleven.requests if "text-to-speech" in r.url.path][0]
    assert (body["voice_settings"]["stability"], body["voice_settings"]["style"]) == (0.7, 0.4)


def test_piper_voice_and_engine_per_channel(client, media_project, eleven):  # noqa: F811
    channel_id = channel_of(client, media_project)
    settings = client.get("/api/settings").json()
    settings["tts_engine"] = "elevenlabs"
    client.put("/api/settings", json=settings)
    memory.remember_generation(channel_id, "piper", "es_ES-davefx-medium", None)
    state = voice_of(client, media_project["id"])
    assert state["default_engine"] == "piper"  # el del canal, no el general
    assert state["default_voice"] == "es_ES-davefx-medium"


def test_damaged_memory_file_starts_empty(home):
    (home / "config").mkdir(parents=True, exist_ok=True)
    (home / "config" / "voces.json").write_text("{no es json", encoding="utf-8")
    assert memory.load().voices == {}
    memory.remember_preset(ElevenLabsPrefs(voice_id="v1", voice_name="Uno"))
    assert memory.load().voices["v1"].voice_name == "Uno"
