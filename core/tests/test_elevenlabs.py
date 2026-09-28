"""Voz con ElevenLabs (opcional): sin llamadas reales, con una API simulada."""

import base64
import json
import wave

import httpx
import pytest

from guionaria_core.services.media import http as media_http
from guionaria_core.services.voice import elevenlabs
from guionaria_core.services.voice.align import Word
from tests.conftest import wait_job

RATE = elevenlabs.SAMPLE_RATE
WORD_S = 0.25  # cada palabra dura 0.25 s en la voz simulada


class FakeEleven:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.status = 200
        self.error_body: dict | None = None

    def tts(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        text = body["text"]
        chars, starts, ends = [], [], []
        t = 0.0
        for word in text.split(" "):
            step = WORD_S / len(word)
            for ch in word:
                chars.append(ch)
                starts.append(round(t, 3))
                t += step
                ends.append(round(t, 3))
            chars.append(" ")
            starts.append(round(t, 3))
            ends.append(round(t, 3))
        pcm = b"\x01\x00" * int(RATE * len(text.split(" ")) * WORD_S)
        return httpx.Response(
            200,
            json={
                "audio_base64": base64.b64encode(pcm).decode(),
                "alignment": {
                    "characters": chars[:-1],
                    "character_start_times_seconds": starts[:-1],
                    "character_end_times_seconds": ends[:-1],
                },
            },
        )

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json=self.error_body or {})
        path = request.url.path
        if path == "/v1/voices":
            return httpx.Response(
                200,
                json={
                    "voices": [
                        {
                            "voice_id": "v-pre",
                            "name": "Adam",
                            "category": "premade",
                            "labels": {"accent": "american"},
                            "preview_url": "https://x/adam.mp3",
                        },
                        {
                            "voice_id": "v-mine",
                            "name": "Mi voz",
                            "category": "cloned",
                            "labels": {},
                            "preview_url": None,
                        },
                    ]
                },
            )
        if path == "/v1/user/subscription":
            return httpx.Response(
                200,
                json={
                    "tier": "free",
                    "character_count": 1200,
                    "character_limit": 10000,
                    "next_character_count_reset_unix": 1790000000,
                },
            )
        if path.startswith("/v1/text-to-speech/"):
            return self.tts(request)
        return httpx.Response(404)


@pytest.fixture
def eleven(client, monkeypatch):
    fake = FakeEleven()
    monkeypatch.setattr(
        media_http,
        "client_factory",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)),
    )
    settings = client.get("/api/settings").json()
    settings["api_keys"]["elevenlabs"] = "xi-123"
    client.put("/api/settings", json=settings)
    return fake


def generate(client, pid, **body):
    resp = client.post(f"/api/projects/{pid}/voice:generate", json=body)
    assert resp.status_code == 202, resp.text
    return wait_job(client, resp.json()["id"])


SETTINGS = {"voice_id": "v-mine", "model_id": "eleven_turbo_v2_5", "stability": 0.4, "speed": 1.1}


def test_words_from_alignment_groups_characters():
    words = elevenlabs.words_from_alignment(
        {
            "characters": list("Hola  mundo."),
            "character_start_times_seconds": [
                0,
                0.1,
                0.2,
                0.3,
                0.4,
                0.45,
                0.5,
                0.6,
                0.7,
                0.8,
                0.9,
                1.0,
            ],
            "character_end_times_seconds": [
                0.1,
                0.2,
                0.3,
                0.4,
                0.45,
                0.5,
                0.6,
                0.7,
                0.8,
                0.9,
                1.0,
                1.1,
            ],
        },
        offset=2.0,
    )
    assert words == [Word("Hola", 2.0, 2.4), Word("mundo.", 2.5, 3.1)]
    assert elevenlabs.words_from_alignment(None) == []


def test_voices_models_and_account(client, eleven):
    voices = client.get("/api/voice/elevenlabs/voices").json()
    assert [v["name"] for v in voices] == ["Mi voz", "Adam"]  # primero las propias
    assert eleven.requests[0].headers["xi-api-key"] == "xi-123"
    models = client.get("/api/voice/elevenlabs/models").json()
    assert models[0]["id"] == "eleven_multilingual_v2"
    account = client.get("/api/voice/elevenlabs/account").json()
    assert account == {
        "tier": "free",
        "used": 1200,
        "limit": 10000,
        "remaining": 8800,
        "resets_at": 1790000000,
        "can_read": True,
    }


def test_without_key(client, monkeypatch):
    resp = client.get("/api/voice/elevenlabs/voices")
    assert resp.status_code == 400
    assert "Falta la clave de ElevenLabs" in resp.json()["detail"]


def test_generate_with_elevenlabs_gives_exact_subtitles(client, media_project, eleven, home):
    pid = media_project["id"]
    job = generate(client, pid, engine="elevenlabs", elevenlabs=SETTINGS, pause_s=0.3)
    assert job["status"] == "done", job["error"]

    tts = [r for r in eleven.requests if "text-to-speech" in r.url.path]
    assert len(tts) == 4
    first, second = json.loads(tts[0].content), json.loads(tts[1].content)
    assert tts[0].url.path == "/v1/text-to-speech/v-mine/with-timestamps"
    assert tts[0].url.params["output_format"] == "pcm_24000"
    assert first["model_id"] == "eleven_turbo_v2_5"
    assert first["voice_settings"]["stability"] == 0.4
    assert first["voice_settings"]["speed"] == 1.1
    assert "previous_text" not in first and first["next_text"] == "Cinco seis siete ocho."
    assert second["previous_text"] == "Uno dos tres cuatro."

    state = client.get(f"/api/projects/{pid}/voice").json()
    assert state["source"] == "elevenlabs"
    assert state["timing_source"] == "voice"
    assert state["voice_id"] == "v-mine"
    assert state["elevenlabs"]["model_id"] == "eleven_turbo_v2_5"
    # 4 palabras × 0.25 s = 1 s por segmento + 0.3 s de pausa.
    assert [s["start_s"] for s in state["segments"]] == [0.0, 1.3, 2.6, 3.9]

    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    srt = (folder / "subs" / "voz.srt").read_text(encoding="utf-8")
    # Subtítulos por palabra, con los tiempos de ElevenLabs desplazados a su lugar.
    assert "00:00:01,300 --> 00:00:02,300\nCinco seis siete ocho." in srt
    with wave.open(str(folder / "audio" / "voz.wav")) as wf:
        assert wf.getframerate() == RATE
        assert round(wf.getnframes() / RATE, 2) == 4.9

    # Se recuerdan los últimos ajustes para la próxima vez.
    prefs = client.get("/api/settings").json()["elevenlabs"]
    assert prefs["voice_id"] == "v-mine" and prefs["speed"] == 1.1


def test_regenerate_segment_keeps_engine_and_other_words(client, media_project, eleven):
    pid = media_project["id"]
    generate(client, pid, engine="elevenlabs", elevenlabs=SETTINGS)
    eleven.requests.clear()
    resp = client.post(f"/api/projects/{pid}/voice/segments/seg_003:regenerate")
    job = wait_job(client, resp.json()["id"])
    assert job["status"] == "done", job["error"]
    tts = [r for r in eleven.requests if "text-to-speech" in r.url.path]
    assert len(tts) == 1
    assert json.loads(tts[0].content)["text"] == "Nueve diez once doce."
    state = client.get(f"/api/projects/{pid}/voice").json()
    assert state["source"] == "elevenlabs"
    assert [s["start_s"] for s in state["segments"]] == [0.0, 1.3, 2.6, 3.9]


@pytest.mark.parametrize(
    ("status", "body", "message"),
    [
        (401, {"detail": {"status": "invalid_api_key"}}, "rechazó la clave"),
        (401, {"detail": {"status": "quota_exceeded", "message": "quota exceeded"}}, "créditos"),
        (400, {"detail": {"status": "voice_not_found"}}, "ya no existe"),
        (429, {}, "demasiadas peticiones"),
    ],
)
def test_generation_errors_are_explained(client, media_project, eleven, status, body, message):
    eleven.status, eleven.error_body = status, body
    job = generate(client, media_project["id"], engine="elevenlabs", elevenlabs=SETTINGS)
    assert job["status"] == "failed"
    assert message in job["error"]


def test_elevenlabs_needs_a_voice(client, media_project, eleven):
    job = generate(client, media_project["id"], engine="elevenlabs")
    assert job["status"] == "failed"
    assert "Elige una voz de ElevenLabs" in job["error"]


def test_key_check_reports_credits(client, eleven):
    resp = client.post("/api/settings/keys/elevenlabs:test", json={"value": None})
    result = resp.json()
    assert result["status"] == "valid"
    assert result["quota_remaining"] == 8800


def test_last_engine_becomes_the_default(client, media_project, eleven):
    pid = media_project["id"]
    assert client.get(f"/api/projects/{pid}/voice").json()["default_engine"] == "piper"
    generate(client, pid, engine="elevenlabs", elevenlabs=SETTINGS)
    assert client.get("/api/settings").json()["tts_engine"] == "elevenlabs"
    assert client.get(f"/api/projects/{pid}/voice").json()["default_engine"] == "elevenlabs"

    # Sin motor ni ajustes: ElevenLabs con los últimos ajustes usados.
    eleven.requests.clear()
    job = generate(client, pid)
    assert job["status"] == "done", job["error"]
    tts = [r for r in eleven.requests if "text-to-speech" in r.url.path]
    assert tts and tts[0].url.path == "/v1/text-to-speech/v-mine/with-timestamps"
