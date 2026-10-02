"""Videos terminados en otro editor (CapCut…): importar a un canal, transcribir con Whisper y
gestionarlos desde Publicación."""

import shutil
import subprocess
from pathlib import Path

import pytest

from guionaria_core.services.voice.align import Word
from tests.conftest import wait_job
from tests.test_voice import engines_fake  # noqa: F401  (fixture)

HAS_FFMPEG = shutil.which("ffmpeg") is not None
pytestmark = pytest.mark.skipif(not HAS_FFMPEG, reason="requiere FFmpeg")


def make_video(path: Path, size: str = "360x640", seconds: float = 6, audio: bool = True) -> Path:
    args = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=30"]
    if audio:
        args += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"]
    args += ["-t", str(seconds), "-pix_fmt", "yuv420p", "-shortest", str(path)]
    subprocess.run(args, check=True)
    return path


def upload(client, channel_id, video: Path, **form):
    with video.open("rb") as fh:
        return client.post(
            f"/api/channels/{channel_id}/projects:import-video",
            files={"file": (video.name, fh, "video/mp4")},
            data={k: str(v).lower() if isinstance(v, bool) else v for k, v in form.items()},
        )


def test_import_capcut_video_ready_to_publish(client, channel, tmp_path, engines_fake):  # noqa: F811
    engines_fake["transcriber"].words = [
        Word("Nadie", 0, 0.4),
        Word("vio", 0.4, 0.7),
        Word("nada.", 0.7, 1.1),
    ]
    video = make_video(tmp_path / "Mi reel CapCut.mp4")
    resp = upload(
        client,
        channel["id"],
        video,
        title="El caso que nadie vio",
        notes="Caso real de 1998 en Lima.",
        target_publish_at="2026-10-05",
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    project = body["project"]
    assert (project["origin"], project["status"], project["format"]) == (
        "importado",
        "RENDERIZADO",
        "reel",
    )
    assert project["target_duration_s"] == 6 and project["target_publish_at"] == "2026-10-05"
    assert project["cover_url"]  # miniatura sugerida del propio video

    # El video queda como render final, con el nombre del título.
    render = client.get(f"/api/projects/{project['id']}/render").json()
    [final] = [f for f in render["files"] if f["kind"] == "final"]
    assert final["name"] == "el-caso-que-nadie-vio.mp4" and final["height"] == 640

    # Whisper transcribe el audio; la transcripción alimenta los textos de Claude.
    job = wait_job(client, body["job"]["id"])
    assert job["status"] == "done" and job["result"] == {"words": 3}
    text = client.get(f"/api/projects/{project['id']}/transcript").json()["text"]
    assert text == "Nadie vio nada."

    # Publicación lista: hay video y las plataformas del canal.
    state = client.get(f"/api/projects/{project['id']}/publishing").json()
    assert state["can_publish"] and state["publications"][0]["platform"] == "youtube"


def test_texts_use_the_transcript(client, channel, tmp_path, engines_fake, fake_claude):  # noqa: F811
    engines_fake["transcriber"].words = [Word("El", 0, 0.2), Word("pituto", 0.2, 0.8)]
    body = upload(client, channel["id"], make_video(tmp_path / "v.mp4")).json()
    pid = body["project"]["id"]
    wait_job(client, body["job"]["id"])
    fake_claude.queue(
        {
            "plataformas": [
                {"plataforma": "youtube", "titulos": ["Un título"],
                 "descripcion": "Texto de descripción de prueba.",
                 "hashtags": [], "etiquetas": [], "comentario_fijado": None}
            ],
            "capitulos": [],
        }
    )  # fmt: skip
    wait_job(client, client.post(f"/api/projects/{pid}/publishing:generate").json()["id"])
    prompt = fake_claude.calls[-1]["prompt"]
    assert "(transcripción del video)\nEl pituto" in prompt


def test_horizontal_video_mov_and_replace(client, channel, tmp_path, engines_fake):  # noqa: F811
    mov = make_video(tmp_path / "largo.mov", size="640x360", seconds=8)
    body = upload(client, channel["id"], mov, transcribe=False).json()
    project = body["project"]
    assert body["job"] is None
    assert (project["format"], project["title"]) == ("video", "largo")  # título: nombre del archivo
    # Reemplazar por otra exportación.
    new = make_video(tmp_path / "v2.mp4", size="640x360", seconds=7)
    with new.open("rb") as fh:
        resp = client.post(
            f"/api/projects/{project['id']}/video:replace",
            files={"file": ("v2.mp4", fh, "video/mp4")},
            data={"transcribe": "false"},
        )
    assert resp.status_code == 200 and resp.json()["project"]["target_duration_s"] == 7


def test_import_rejects_non_videos(client, channel, tmp_path):
    bad = tmp_path / "nota.mp4"
    bad.write_bytes(b"no soy un video")
    resp = upload(client, channel["id"], bad)
    assert resp.status_code == 400 and "video" in resp.json()["detail"]
    txt = tmp_path / "nota.txt"
    txt.write_text("x", encoding="utf-8")
    assert "Formato no admitido" in upload(client, channel["id"], txt).json()["detail"]
    # No quedó ningún proyecto a medias.
    assert client.get("/api/projects").json() == []


def test_thumbnail_frames_come_from_the_imported_video(client, channel, tmp_path, fake_claude):
    body = upload(client, channel["id"], make_video(tmp_path / "v.mp4"), transcribe=False).json()
    pid = body["project"]["id"]
    fake_claude.queue(
        {"disenos": [{"cuadro": 2, "plantilla": "impacto", "texto": "Nadie vio nada",
                      "color": "#FFD400", "foco_x": 0.5, "foco_y": 0.5}]}
    )  # fmt: skip
    job = wait_job(
        client, client.post(f"/api/projects/{pid}/publishing/cover:design").json()["id"], 60
    )
    assert job["status"] == "done", job["error"]
    assert "cuadro_08.jpg" in fake_claude.calls[-1]["prompt"]  # 8 cuadros repartidos
    assert len(client.get(f"/api/projects/{pid}/publishing").json()["cover_options"]) == 1


def test_mcp_import_by_path(client, channel, tmp_path):
    from tests.test_mcp import Mcp

    video = make_video(tmp_path / "desde chat.mp4")
    out = Mcp(client).call(
        "import_finished_video", channel=channel["name"], path=str(video), transcribe=False
    )
    assert out["project"]["origin"] == "importado" and out["project"]["title"] == "desde chat"
