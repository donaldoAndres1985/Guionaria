"""Video desde URL con yt-dlp (el descargador se simula: sin internet)."""

import shutil
import subprocess

import pytest

from guionaria_core.services.errors import DomainError
from guionaria_core.services.media import video_url
from tests.conftest import wait_job


@pytest.fixture
def fake_ytdlp(monkeypatch, tmp_path):
    """Descargador simulado: registra los argumentos y deja un archivo de video."""
    calls = []
    source = tmp_path / "fuente.mp4"
    if shutil.which("ffmpeg"):
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x180:rate=10",
                "-t",
                "3",
                "-pix_fmt",
                "yuv420p",
                str(source),
            ],
            check=True,
        )
    else:
        source.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"0" * 4096)

    def fake(url, out_dir, start_s, end_s, progress):
        calls.append({"url": url, "start_s": start_s, "end_s": end_s})
        progress(0.5)
        target = out_dir / "abc123.mp4"
        shutil.copy(source, target)
        return {
            "path": str(target),
            "title": "Noticia: el caso Priscila",
            "uploader": "Canal Noticias",
            "webpage_url": "https://www.youtube.com/watch?v=abc123",
            "duration": 3,
        }

    monkeypatch.setattr(video_url, "downloader", fake)
    monkeypatch.setattr(video_url.shutil, "which", lambda name: "C:/ffmpeg/ffmpeg.exe")
    return calls


def request(client, scene_id, **body):
    return client.post(f"/api/scenes/{scene_id}/assets:video-url", json=body)


def test_download_video_fragment(client, media_project, fake_ytdlp):
    real = media_project["scenes"][2]
    resp = request(
        client, real, url="https://www.youtube.com/watch?v=abc123", start_s=10, end_s=14.5
    )
    assert resp.status_code == 202
    job = wait_job(client, resp.json()["id"])
    assert job["status"] == "done"
    assert job["type"] == "download_url"
    assert job["result"]["title"] == "Noticia: el caso Priscila"
    assert job["result"]["approved"] is True
    assert fake_ytdlp == [
        {"url": "https://www.youtube.com/watch?v=abc123", "start_s": 10.0, "end_s": 14.5}
    ]

    media = client.get(f"/api/scenes/{real}/media").json()
    [cand] = media["candidates"]
    assert cand["provider"] == "manual"
    assert cand["kind"] == "video"
    assert cand["page_url"] == "https://www.youtube.com/watch?v=abc123"
    asset = cand["asset"]
    assert asset["file_name"] == "003_manual_noticia-el-caso-priscila.mp4"
    assert asset["author"] == "Canal Noticias"
    assert asset["license"] == "Derechos: revisar (fragmento con comentario)"
    assert media["approved"][0]["file_name"].startswith("003_0004_real_")


def test_whole_video_without_fragment(client, media_project, fake_ytdlp):
    job = wait_job(
        client, request(client, media_project["scenes"][2], url="https://vimeo.com/1").json()["id"]
    )
    assert job["status"] == "done"
    assert fake_ytdlp[0]["start_s"] is None and fake_ytdlp[0]["end_s"] is None


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"url": "ftp://x"}, "http"),
        ({"url": "https://youtu.be/a", "start_s": 5}, "inicio y fin"),
        ({"url": "https://youtu.be/a", "start_s": 9, "end_s": 3}, "mayor que el inicio"),
        ({"url": "https://youtu.be/a", "start_s": -1, "end_s": 3}, "mayor que el inicio"),
    ],
)
def test_validation(client, media_project, fake_ytdlp, body, message):
    resp = request(client, media_project["scenes"][2], **body)
    assert resp.status_code == 400
    assert message in resp.json()["detail"]
    assert fake_ytdlp == []


def test_download_errors_are_reported(client, media_project, monkeypatch):
    def failing(*args):
        raise DomainError("No se pudo descargar el video: Video unavailable")

    monkeypatch.setattr(video_url, "downloader", failing)
    monkeypatch.setattr(video_url.shutil, "which", lambda name: "ffmpeg")
    job = wait_job(
        client, request(client, media_project["scenes"][2], url="https://youtu.be/x").json()["id"]
    )
    assert job["status"] == "failed"
    assert job["error"] == "No se pudo descargar el video: Video unavailable"


def test_requires_ffmpeg(client, media_project, monkeypatch):
    monkeypatch.setattr(video_url.shutil, "which", lambda name: None)
    job = wait_job(
        client, request(client, media_project["scenes"][2], url="https://youtu.be/x").json()["id"]
    )
    assert job["status"] == "failed"
    assert "FFmpeg" in job["error"]


def test_requires_open_media_stage(client, media_project, fake_ytdlp):
    client.post(f"/api/projects/{media_project['id']}/scenes:unlock")
    job = wait_job(
        client, request(client, media_project["scenes"][2], url="https://youtu.be/x").json()["id"]
    )
    assert job["status"] == "failed"
    assert fake_ytdlp == []


def test_ytdlp_options(monkeypatch, tmp_path):
    """Opciones reales pasadas a yt-dlp: hasta 1080p en MP4 y recorte por tramo."""
    captured = {}

    class FakeYDL:
        def __init__(self, opts):
            captured.update(opts)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download):
            (tmp_path / "v.mp4").write_bytes(b"x")
            return {
                "title": "T",
                "uploader": "U",
                "webpage_url": url,
                "requested_downloads": [{"filepath": str(tmp_path / "v.mp4")}],
            }

    import yt_dlp

    monkeypatch.setattr(yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(video_url.shutil, "which", lambda name: "C:/ffmpeg/bin/ffmpeg.exe")
    info = video_url._ytdlp_download("https://youtu.be/x", tmp_path, 2, 6, lambda p: None)
    assert info["path"].endswith("v.mp4")
    assert captured["merge_output_format"] == "mp4"
    assert "height<=1080" in captured["format"]
    assert captured["noplaylist"] is True
    assert captured["force_keyframes_at_cuts"] is True
    assert "download_ranges" in captured
    assert captured["ffmpeg_location"].replace("\\", "/").endswith("ffmpeg/bin")


def test_health_reports_bundled_ytdlp(client):
    deps = {d["name"]: d for d in client.get("/api/health?refresh=true").json()["dependencies"]}
    assert deps["yt-dlp"]["ok"] is True
    assert deps["yt-dlp"]["path"] == "incluido en el núcleo"
