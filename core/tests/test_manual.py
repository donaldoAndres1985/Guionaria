import io

import httpx
import pytest
from PIL import Image

from guionaria_core.services import system
from tests.media_support import downloaded, search


def png_file(path, w=90, h=160):
    Image.new("RGB", (w, h), (10, 120, 200)).save(path, "PNG")
    return path


def media_of(client, scene):
    return client.get(f"/api/scenes/{scene}/media").json()


def manual_dir(home):
    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    return folder / "media" / "manual"


# --- archivo local (arrastrado desde el explorador) ------------------------------------


def test_import_local_file_auto_approves_when_scene_has_no_main(
    client, media_project, home, tmp_path
):
    real_scene = media_project["scenes"][2]
    src = png_file(tmp_path / "Foto de Priscila.png")
    resp = client.post(f"/api/scenes/{real_scene}/assets:import", json={"path": str(src)})
    assert resp.status_code == 200
    media = resp.json()
    [cand] = media["candidates"]
    assert cand["provider"] == "manual"
    assert cand["download_status"] == "manual"
    assert cand["asset"]["file_name"] == "003_manual_foto-de-priscila.png"
    assert (cand["asset"]["width"], cand["asset"]["height"]) == (90, 160)
    assert cand["asset"]["thumb_url"]
    # Se aprobó como principal y se copió con la convención.
    assert media["status"] == "approved"
    assert media["approved"][0]["file_name"] == "003_0004_real_priscila-loera-foto.png"
    assert (manual_dir(home) / "003_manual_foto-de-priscila.png").exists()
    assert src.exists()  # el original no se toca


def test_second_import_does_not_replace_main(client, media_project, tmp_path):
    scene = media_project["scenes"][2]
    for name in ("a.png", "b.png"):
        client.post(
            f"/api/scenes/{scene}/assets:import", json={"path": str(png_file(tmp_path / name))}
        )
    media = media_of(client, scene)
    assert len(media["candidates"]) == 2
    assert [a["role"] for a in media["approved"]] == ["main"]
    assert media["approved"][0]["asset"]["file_name"] == "003_manual_a.png"


def test_same_name_twice_gets_unique_file(client, media_project, tmp_path):
    scene = media_project["scenes"][2]
    src = png_file(tmp_path / "x.png")
    client.post(f"/api/scenes/{scene}/assets:import", json={"path": str(src)})
    client.post(f"/api/scenes/{scene}/assets:import", json={"path": str(src)})
    names = [c["asset"]["file_name"] for c in media_of(client, scene)["candidates"]]
    assert names == ["003_manual_x.png", "003_manual_x-2.png"]


def test_import_validation(client, media_project, tmp_path):
    scene = media_project["scenes"][2]
    bad = tmp_path / "notas.txt"
    bad.write_text("hola")
    resp = client.post(f"/api/scenes/{scene}/assets:import", json={"path": str(bad)})
    assert resp.status_code == 400 and "Formato no admitido" in resp.json()["detail"]
    fake = tmp_path / "falsa.jpg"
    fake.write_bytes(b"no soy una imagen")
    resp = client.post(f"/api/scenes/{scene}/assets:import", json={"path": str(fake)})
    assert resp.status_code == 400 and "no es una imagen" in resp.json()["detail"]
    missing = client.post(
        f"/api/scenes/{scene}/assets:import", json={"path": str(tmp_path / "no.png")}
    )
    assert missing.status_code == 400
    both = client.post(f"/api/scenes/{scene}/assets:import", json={"path": "a", "url": "https://x"})
    assert both.status_code == 422
    assert client.post(f"/api/scenes/{scene}/assets:import", json={}).status_code == 422


def test_dropping_on_failed_candidate_keeps_its_provenance(client, media_project, web, tmp_path):
    scene = media_project["scenes"][1]
    [c1, *_] = search(client, scene).json()["scene"]["candidates"]
    web.respond("https://images.pexels.com/1.jpeg", httpx.Response(403))
    web.respond("https://images.pexels.com/1-m.jpeg", httpx.Response(403))
    job = client.post(
        f"/api/scenes/{scene}/candidates:download", json={"candidate_ids": [c1["id"]]}
    ).json()
    from tests.conftest import wait_job

    wait_job(client, job["id"])
    assert media_of(client, scene)["candidates"][0]["download_status"] == "failed"

    src = png_file(tmp_path / "bajada-a-mano.png")
    media = client.post(
        f"/api/scenes/{scene}/assets:import", json={"path": str(src), "candidate_id": c1["id"]}
    ).json()
    cand = next(c for c in media["candidates"] if c["id"] == c1["id"])
    assert cand["download_status"] == "manual"
    assert cand["error"] is None
    assert cand["asset"]["provider"] == "pexels"
    assert cand["asset"]["author"] == "Autor 1"
    assert cand["asset"]["license"] == "Pexels License"
    assert media["approved"][0]["asset"]["id"] == cand["asset"]["id"]


def test_candidate_from_another_scene_rejected(client, media_project, web, tmp_path):
    a, b = media_project["scenes"][:2]
    [ca, _] = search(client, a).json()["scene"]["candidates"]
    resp = client.post(
        f"/api/scenes/{b}/assets:import",
        json={"path": str(png_file(tmp_path / "x.png")), "candidate_id": ca["id"]},
    )
    assert resp.status_code == 400


def test_import_requires_open_media_stage(client, media_project, tmp_path):
    pid = media_project["id"]
    client.post(f"/api/projects/{pid}/scenes:unlock")
    resp = client.post(
        f"/api/scenes/{media_project['scenes'][2]}/assets:import",
        json={"path": str(png_file(tmp_path / "x.png"))},
    )
    assert resp.status_code == 409


# --- subida (Ctrl+V o arrastrar desde el navegador) ------------------------------------


def test_upload_pasted_image(client, media_project):
    scene = media_project["scenes"][2]
    buf = io.BytesIO()
    Image.new("RGB", (40, 70), (1, 2, 3)).save(buf, "PNG")
    resp = client.post(
        f"/api/scenes/{scene}/assets:upload",
        files={"file": ("image.png", buf.getvalue(), "image/png")},
    )
    assert resp.status_code == 200
    assert resp.json()["approved"][0]["asset"]["width"] == 40


def test_upload_rejects_unknown_format(client, media_project):
    resp = client.post(
        f"/api/scenes/{media_project['scenes'][2]}/assets:upload",
        files={"file": ("doc.pdf", b"%PDF", "application/pdf")},
    )
    assert resp.status_code == 400


# --- desde una URL ----------------------------------------------------------------------


def test_import_direct_image_url(client, media_project, web):
    scene = media_project["scenes"][2]
    media = client.post(
        f"/api/scenes/{scene}/assets:import",
        json={"url": "https://noticias.example/fotos/priscila.jpg"},
    ).json()
    [cand] = media["candidates"]
    assert cand["page_url"] == "https://noticias.example/fotos/priscila.jpg"
    assert cand["asset"]["file_name"] == "003_manual_priscila.jpg"


def test_import_page_uses_og_image(client, media_project, web):
    page = (
        '<html><head><meta property="og:title" content="Nota">'
        '<meta content="/img/portada.jpg" property="og:image"></head></html>'
    )
    web.respond(
        "https://noticias.example/nota",
        httpx.Response(200, text=page, headers={"content-type": "text/html; charset=utf-8"}),
    )
    scene = media_project["scenes"][2]
    media = client.post(
        f"/api/scenes/{scene}/assets:import", json={"url": "https://noticias.example/nota"}
    ).json()
    [cand] = media["candidates"]
    assert cand["page_url"] == "https://noticias.example/nota"  # se guarda la página (créditos)
    assert cand["asset"]["file_name"] == "003_manual_portada.jpg"
    assert any(str(r.url) == "https://noticias.example/img/portada.jpg" for r in web.requests)


@pytest.mark.parametrize(
    ("url", "status", "message"),
    [
        ("ftp://x.example/a.jpg", 400, "http"),
        ("https://www.youtube.com/watch?v=abc", 400, "Fase 2"),
        ("https://youtu.be/abc", 400, "Fase 2"),
    ],
)
def test_import_url_rejections(client, media_project, web, url, status, message):
    resp = client.post(f"/api/scenes/{media_project['scenes'][2]}/assets:import", json={"url": url})
    assert resp.status_code == status
    assert message in resp.json()["detail"]


def test_page_without_main_image(client, media_project, web):
    web.respond(
        "https://blog.example/",
        httpx.Response(200, text="<html></html>", headers={"content-type": "text/html"}),
    )
    resp = client.post(
        f"/api/scenes/{media_project['scenes'][2]}/assets:import",
        json={"url": "https://blog.example/"},
    )
    assert resp.status_code == 400
    assert "imagen principal" in resp.json()["detail"]


def test_url_not_media(client, media_project, web):
    web.respond("https://api.example/data", httpx.Response(200, json={"a": 1}))
    resp = client.post(
        f"/api/scenes/{media_project['scenes'][2]}/assets:import",
        json={"url": "https://api.example/data"},
    )
    assert resp.status_code == 400


# --- sistema ------------------------------------------------------------------------------


@pytest.fixture
def launched(monkeypatch):
    calls = {"browser": [], "launch": []}
    monkeypatch.setattr(system, "open_browser", lambda url: calls["browser"].append(url))
    monkeypatch.setattr(system, "launch", lambda args: calls["launch"].append(args))
    return calls


def test_open_url_only_http(client, launched):
    assert (
        client.post("/api/system/open-url", json={"url": "https://pexels.com/photo/1"}).status_code
        == 204
    )
    assert launched["browser"] == ["https://pexels.com/photo/1"]
    assert (
        client.post("/api/system/open-url", json={"url": "file:///C:/Windows"}).status_code == 400
    )
    assert (
        client.post("/api/system/open-url", json={"url": "javascript:alert(1)"}).status_code == 400
    )
    assert launched["browser"] == ["https://pexels.com/photo/1"]


def test_reveal_asset_and_project(client, media_project, web, launched):
    scene = media_project["scenes"][1]
    [asset, *_] = downloaded(client, scene)
    assert client.post(f"/api/assets/{asset['id']}:reveal").status_code == 204
    assert client.post(f"/api/projects/{media_project['id']}:reveal").status_code == 204
    assert len(launched["launch"]) == 2
    first = launched["launch"][0]
    assert first[-1].endswith("002_pexels_1.jpg") or "002_pexels_1.jpg" in first[-1]
    assert client.post("/api/assets/999:reveal").status_code == 404


# --- paquete ------------------------------------------------------------------------------


def test_export_package(client, media_project, web, home, tmp_path):
    pid = media_project["id"]
    video, image, real, _text = media_project["scenes"]
    for scene in (video, image):
        [asset, *_] = downloaded(client, scene)
        client.post(f"/api/scenes/{scene}/assets/{asset['id']}:approve")
    client.post(
        f"/api/scenes/{real}/assets:import", json={"path": str(png_file(tmp_path / "real.png"))}
    )

    result = client.post(f"/api/projects/{pid}:export-package").json()
    assert result["files"] == ["guion.md", "escenas.md", "escenas.csv", "creditos.txt", "LEEME.txt"]
    assert result["missing_media"] == []

    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    credits = (folder / "creditos.txt").read_text(encoding="utf-8")
    assert "Pexels:" in credits
    assert "Escena 1 (0:00): Video 10 — Pexels License" in credits
    assert "https://www.pexels.com/video/10/" in credits
    assert "Material propio:" in credits  # archivo local sin URL de origen
    assert "Imágenes y videos de Pexels." in credits
    assert "Fuentes:" not in credits

    readme = (folder / "LEEME.txt").read_text(encoding="utf-8")
    assert "Reel 9:16 (1080×1920) · 4 escenas" in readme
    assert "001_0000_video_mexico-city-aerial.mp4" in readme
    assert "003_0004_real_priscila-loera-foto.png" in readme
    assert "(se genera en edición)" in readme
    assert "texto: «SIN RESPUESTA»" in readme
    assert (folder / "guion.md").read_text(encoding="utf-8").startswith("# El secuestro")


def test_export_package_reports_missing_media(client, media_project):
    result = client.post(f"/api/projects/{media_project['id']}:export-package").json()
    assert result["missing_media"] == [1, 2, 3]


def test_export_package_without_scenes(client, project):
    assert client.post(f"/api/projects/{project['id']}:export-package").status_code == 409


def test_credits_mark_web_material_as_third_party(client, media_project, web, home):
    scene = media_project["scenes"][2]
    client.post(
        f"/api/scenes/{scene}/assets:import", json={"url": "https://noticias.example/fotos/p.jpg"}
    )
    client.post(f"/api/projects/{media_project['id']}:export-package")
    [folder] = (home / "channels" / "casos-reales" / "projects").iterdir()
    credits = (folder / "creditos.txt").read_text(encoding="utf-8")
    assert "Material de terceros (revisa los derechos antes de publicar):" in credits
    assert "Escena 3 (0:04): autor sin identificar" in credits
    assert "Fuentes: https://noticias.example/fotos/p.jpg" in credits
    assert "Material propio." not in credits


def test_too_long_path_gives_clear_error(client, media_project, tmp_path, monkeypatch):
    from guionaria_core.util import paths

    monkeypatch.setattr(paths, "WINDOWS_MAX_PATH", 20)
    monkeypatch.setattr(paths, "long_paths_enabled", lambda: False)
    resp = client.post(
        f"/api/scenes/{media_project['scenes'][2]}/assets:import",
        json={"path": str(png_file(tmp_path / "x.png"))},
    )
    assert resp.status_code == 400
    assert "Windows admite" in resp.json()["detail"]
    assert "GUIONARIA_HOME" in resp.json()["detail"]
