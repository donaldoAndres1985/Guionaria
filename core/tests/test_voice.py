import asyncio
import wave

import httpx
import pytest

from guionaria_core.services.voice import engines, models
from guionaria_core.services.voice.align import Word
from tests.conftest import wait_job
from tests.media_support import downloaded, status_of

RATE = 16000


def write_wav(path, seconds):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes(b"\x01\x00" * int(RATE * seconds))


class FakeSynth:
    """0.25 s por palabra (a velocidad 1): el guion de prueba tiene 4 palabras por segmento."""

    def __init__(self):
        self.calls = []

    def synthesize(self, text, out_path, speed):
        self.calls.append((text, speed))
        write_wav(out_path, len(text.split()) * 0.25 / speed)


class FakeTranscriber:
    def __init__(self):
        self.words = []
        self.calls = []

    def transcribe(self, audio, language):
        self.calls.append((audio, language))
        return self.words


@pytest.fixture
def engines_fake(monkeypatch, home):
    synth, transcriber = FakeSynth(), FakeTranscriber()
    voices = []

    async def fake_ensure_voice(voice_id, ctx=None):
        voices.append(voice_id)
        return home / "models" / "piper" / f"{voice_id}.onnx"

    async def fake_ensure_whisper(size, ctx=None):
        return home / "models" / "whisper" / size

    monkeypatch.setattr(models, "ensure_voice", fake_ensure_voice)
    monkeypatch.setattr(models, "ensure_whisper", fake_ensure_whisper)
    monkeypatch.setattr(engines, "synthesizer_factory", lambda p: synth)
    monkeypatch.setattr(engines, "transcriber_factory", lambda p: transcriber)
    return {"synth": synth, "transcriber": transcriber, "voices": voices}


def vurl(pid, suffix=""):
    return f"/api/projects/{pid}/voice{suffix}"


def generate(client, pid, **body):
    resp = client.post(vurl(pid, ":generate"), json=body)
    assert resp.status_code == 202, resp.text
    return wait_job(client, resp.json()["id"])


def scene_times(client, pid):
    return [
        (s["start_s"], s["end_s"], s["timing_source"])
        for s in client.get(f"/api/projects/{pid}/scenes").json()["scenes"]
    ]


def test_voice_requires_approved_script(client, project, engines_fake):
    pid = project["id"]
    state = client.get(vurl(pid)).json()
    assert state["can_edit"] is False
    assert "Aprueba el guion" in state["reason"]
    assert client.post(vurl(pid, ":generate"), json={}).status_code == 409


def test_generate_voice_sets_real_timings_and_subtitles(client, media_project, engines_fake, home):
    pid = media_project["id"]
    # Antes de la voz: tiempos estimados (2 palabras/s → 2 s por segmento).
    assert scene_times(client, pid)[1] == (2.0, 4.0, "estimated")

    job = generate(client, pid)
    assert job["status"] == "done", job["error"]
    assert job["result"]["voice_id"] == models.DEFAULT_VOICE  # sin voz en canal ni Ajustes
    assert len(engines_fake["synth"].calls) == 4

    # 1 s por segmento + 0.3 s de pausa entre segmentos.
    assert scene_times(client, pid) == [
        (0.0, 1.0, "voice"),
        (1.3, 2.3, "voice"),
        (2.6, 3.6, "voice"),
        (3.9, 4.9, "voice"),
    ]
    state = client.get(vurl(pid)).json()
    assert state["source"] == "piper"
    assert state["timing_source"] == "voice"
    assert state["stale"] is False
    assert state["duration_s"] == 4.9
    assert [s["start_s"] for s in state["segments"]] == [0.0, 1.3, 2.6, 3.9]
    assert state["subtitles"] == ["voz.srt", "voz.vtt"]

    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    srt = (folder / "subs" / "voz.srt").read_text(encoding="utf-8")
    assert srt.startswith("1\n00:00:00,000 --> 00:00:01,000\nUno dos tres cuatro.\n")
    with wave.open(str(folder / "audio" / "voz.wav")) as wf:
        assert wf.getnframes() == int(RATE * 4.9)

    audio = client.get(vurl(pid, "/audio"))
    assert audio.status_code == 200 and audio.content[:4] == b"RIFF"
    assert client.get(vurl(pid, "/segments/seg_002/audio")).status_code == 200
    assert client.get(vurl(pid, "/segments/seg_999/audio")).status_code == 404


def test_voice_speed_pause_and_channel_voice(client, media_project, engines_fake, channel):
    pid = media_project["id"]
    client.patch(f"/api/channels/{channel['id']}", json={"default_voice": "es_ES-davefx-medium"})
    generate(client, pid, speed=1.25, pause_s=0)
    assert engines_fake["voices"] == ["es_ES-davefx-medium"]
    assert engines_fake["synth"].calls[0] == ("Uno dos tres cuatro.", 1.25)
    assert scene_times(client, pid)[3][:2] == (2.4, 3.2)  # 0.8 s por segmento, sin pausa

    generate(client, pid, voice_id="es_MX-ald-medium")
    assert engines_fake["voices"][-1] == "es_MX-ald-medium"


def test_generate_validates_speed(client, media_project, engines_fake):
    assert client.post(vurl(media_project["id"], ":generate"), json={"speed": 3}).status_code == 422


def test_regenerate_one_segment_keeps_the_rest(client, media_project, engines_fake):
    pid = media_project["id"]
    resp = client.post(vurl(pid, "/segments/seg_002:regenerate"))
    job = wait_job(client, resp.json()["id"])
    assert job["status"] == "failed"
    assert "Primero genera la voz completa" in job["error"]

    generate(client, pid, speed=1.0, pause_s=0.5)
    synth = engines_fake["synth"]
    synth.calls.clear()
    job = wait_job(client, client.post(vurl(pid, "/segments/seg_002:regenerate")).json()["id"])
    assert job["status"] == "done", job["error"]
    assert synth.calls == [("Cinco seis siete ocho.", 1.0)]  # solo ese segmento
    assert scene_times(client, pid)[1][:2] == (1.5, 2.5)  # conserva la pausa elegida

    job = wait_job(client, client.post(vurl(pid, "/segments/seg_999:regenerate")).json()["id"])
    assert "No existe el segmento seg_999" in job["error"]


def test_script_change_makes_voice_stale(client, media_project, engines_fake):
    pid = media_project["id"]
    generate(client, pid)
    client.post(f"/api/projects/{pid}/scenes:unlock")
    client.post(f"/api/projects/{pid}/script:unlock")
    script = client.get(f"/api/projects/{pid}/script").json()
    segments = [
        {k: s[k] for k in ("seg_key", "section", "text", "needs_fact_check")}
        for s in script["segments"]
    ]
    segments[0]["text"] = "Un texto nuevo y más largo."
    assert client.put(f"/api/projects/{pid}/script", json={"segments": segments}).status_code == 200
    client.post(f"/api/projects/{pid}/script:approve")

    state = client.get(vurl(pid)).json()
    assert state["stale"] is True
    assert state["timing_source"] is None
    assert {t[2] for t in scene_times(client, pid)} == {"estimated"}


def test_upload_and_transcribe_recorded_voice(client, media_project, engines_fake, tmp_path):
    pid = media_project["id"]
    assert client.post(vurl(pid, ":transcribe")).status_code == 202  # falla: aún no hay voz
    wav = tmp_path / "mi voz.wav"
    write_wav(wav, 6.0)

    bad = client.post(vurl(pid, ":upload"), files={"file": ("voz.txt", b"x")})
    assert bad.status_code == 400
    state = client.post(
        vurl(pid, ":upload"), files={"file": ("mi voz.wav", wav.read_bytes())}
    ).json()
    assert state["source"] == "recorded"
    assert state["duration_s"] == 6.0
    assert state["timing_source"] is None
    assert {t[2] for t in scene_times(client, pid)} == {"estimated"}

    transcriber = engines_fake["transcriber"]
    transcriber.words = [
        Word(w, i * 0.4, i * 0.4 + 0.35)
        for i, w in enumerate(
            [
                "Uno",
                "dos",
                "tres",
                "cuatro",
                "cinco",
                "seis",
                "siete",
                "ocho",
                "nueve",
                "diez",
                "once",
                "doce",
                "trece",
                "catorce",
                "quince",
                "dieciséis.",
            ]
        )
    ]
    job = wait_job(client, client.post(vurl(pid, ":transcribe")).json()["id"])
    assert job["status"] == "done", job["error"]
    assert job["result"] == {"words": 16, "segments": 4}
    assert transcriber.calls[0][1] == "es"
    assert scene_times(client, pid) == [
        (0.0, 1.55, "whisper"),
        (1.6, 3.15, "whisper"),
        (3.2, 4.75, "whisper"),
        (4.8, 6.35, "whisper"),
    ]
    state = client.get(vurl(pid)).json()
    assert (state["timing_source"], state["word_count"]) == ("whisper", 16)


def test_transcribe_without_speech_fails(client, media_project, engines_fake, tmp_path):
    pid = media_project["id"]
    client.post(vurl(pid, ":upload"), files={"file": ("v.wav", b"RIFF0000")})
    job = wait_job(client, client.post(vurl(pid, ":transcribe")).json()["id"])
    assert "Whisper no encontró voz" in job["error"]


def approve_all_media(client, media_project):
    video, image, real, _text = media_project["scenes"]
    for scene in (video, image, real):
        [asset, *_] = downloaded(client, scene)
        client.post(f"/api/scenes/{scene}/assets/{asset['id']}:approve")
    assert client.post(f"/api/projects/{media_project['id']}/media:approve").status_code == 200


def test_voice_after_media_approval_sets_voz_lista(client, media_project, web, engines_fake):
    pid = media_project["id"]
    approve_all_media(client, media_project)
    assert status_of(client, pid) == "MEDIOS_APROBADOS"
    generate(client, pid)
    assert status_of(client, pid) == "VOZ_LISTA"


def test_media_approval_with_ready_voice_goes_to_voz_lista(
    client, media_project, web, engines_fake
):
    pid = media_project["id"]
    generate(client, pid)
    approve_all_media(client, media_project)
    assert status_of(client, pid) == "VOZ_LISTA"


def test_delete_project_removes_voice(client, media_project, engines_fake):
    from sqlmodel import Session, select

    from guionaria_core.db import get_engine
    from guionaria_core.models import VoiceTrack

    pid = media_project["id"]
    generate(client, pid)
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.delete(f"/api/trash/{pid}").status_code == 204  # borrado definitivo
    with Session(get_engine()) as session:
        assert session.exec(select(VoiceTrack)).all() == []


# --- catálogo y descarga de voces (web simulada) ---


def test_voice_catalog_falls_back_offline(client, web):
    web.respond(models.CATALOG_URL, httpx.ConnectError("sin red"))
    voices = client.get("/api/voice/voices").json()
    assert voices[0]["id"] == models.DEFAULT_VOICE
    assert all(v["installed"] is False for v in voices)


CATALOG = {
    "es_MX-claude-high": {
        "quality": "high",
        "num_speakers": 1,
        "language": {"family": "es", "country_english": "Mexico"},
        "files": {
            "es/es_MX/claude/high/es_MX-claude-high.onnx": {"size_bytes": 63_000_000},
            "es/es_MX/claude/high/es_MX-claude-high.onnx.json": {"size_bytes": 5000},
        },
    },
    "en_US-amy-low": {
        "quality": "low",
        "language": {"family": "en", "country_english": "United States"},
        "files": {"en/en_US/amy/low/en_US-amy-low.onnx": {}},
    },
}


def test_catalog_and_voice_download(home, web):
    asyncio.run(_catalog_and_voice_download(web))


async def _catalog_and_voice_download(web):
    web.respond(models.CATALOG_URL, httpx.Response(200, json=CATALOG))
    web.respond(
        models.PIPER_BASE + "es/",
        httpx.Response(200, content=b"{}"),
        httpx.Response(200, content=b"onnx"),
    )
    voices = await models.voice_catalog()
    assert [v.id for v in voices] == ["es_MX-claude-high"]  # solo español
    assert voices[0].label == "México · claude (calidad alta)"
    assert voices[0].size_mb == 63

    path = await models.ensure_voice("es_MX-claude-high")
    assert path.read_bytes() == b"onnx"
    assert (await models.voice_catalog())[0].installed is True  # catálogo en caché
    assert await models.ensure_voice("es_MX-claude-high") == path  # ya instalada: sin red

    with pytest.raises(Exception, match="No existe la voz"):
        await models.ensure_voice("es_XX-nadie-low")


def test_whisper_download_is_reused(home, monkeypatch):
    calls = []

    def fake_download(size):
        calls.append(size)
        target = models.whisper_dir(size)
        target.mkdir(parents=True)
        (target / "model.bin").write_bytes(b"x")
        return target

    monkeypatch.setattr(models, "whisper_downloader", fake_download)
    assert asyncio.run(models.ensure_whisper("base")) == models.whisper_dir("base")
    asyncio.run(models.ensure_whisper("base"))
    assert calls == ["base"]
    with pytest.raises(Exception, match="desconocido"):
        asyncio.run(models.ensure_whisper("gigante"))
