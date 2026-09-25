"""Fuentes de material real y stock añadidas en la Fase 2 (sección 7)."""

import httpx
import pytest

from tests.conftest import wait_job
from tests.media_support import download, search, set_keys


def real_scene(media_project):
    return media_project["scenes"][2]


def by_provider(candidates, provider):
    return [c for c in candidates if c["provider"] == provider]


def test_real_scene_searches_web_commons_and_openverse(client, media_project, web):
    body = search(client, real_scene(media_project)).json()
    candidates = body["scene"]["candidates"]
    assert body["warnings"] == []
    # Intercalados: uno de cada fuente por turno.
    assert [c["provider"] for c in candidates][:3] == ["searxng", "wikimedia", "openverse"]

    [sx] = by_provider(candidates, "searxng")  # el horizontal se filtró en el reel
    assert sx["full_url"] == "https://noticias.example/foto.jpg"
    assert sx["page_url"] == "https://noticias.example/nota"
    assert (sx["width"], sx["height"]) == (800, 1200)
    assert sx["license"] == "Derechos: revisar"
    assert sx["author"] == "noticias.example"
    assert len(sx["provider_id"]) == 12  # identificador estable (sha1), no hash() de Python

    [wm] = by_provider(candidates, "wikimedia")  # el horizontal se filtró
    assert wm["author"] == "Ana Pérez"  # HTML limpio y entidades decodificadas
    assert wm["license"] == "CC BY-SA 4.0"
    assert wm["preview_url"].endswith("a-640.jpg")
    assert wm["page_url"] == "https://commons.wikimedia.org/wiki/File:A.jpg"

    ov = by_provider(candidates, "openverse")
    assert [c["license"] for c in ov] == ["CC BY 2.0", "Dominio público (CC0)"]
    assert ov[0]["author"] == "Usuario Flickr"


def test_requests_carry_query_orientation_and_paging(client, media_project, web):
    search(client, real_scene(media_project))
    ov = next(r for r in web.requests if r.url.host == "api.openverse.org")
    assert ov.url.params["q"] == "priscila loera foto"
    assert ov.url.params["aspect_ratio"] == "tall"
    wm = next(r for r in web.requests if r.url.host == "commons.wikimedia.org")
    assert wm.url.params["gsrsearch"] == "priscila loera foto filetype:bitmap"
    assert wm.url.params["gsrnamespace"] == "6"
    sx = next(r for r in web.requests if r.url.port == 8888)
    assert sx.url.params["categories"] == "images"
    assert sx.url.params["format"] == "json"

    web.requests.clear()
    search(client, real_scene(media_project), page=2, providers=["wikimedia"])
    wm = next(r for r in web.requests if r.url.host == "commons.wikimedia.org")
    assert wm.url.params["gsroffset"] == "15"


def test_searxng_down_or_without_json_becomes_warning(client, media_project, web):
    web.respond("http://127.0.0.1:8888/search", httpx.ConnectError("rechazada"))
    body = search(client, real_scene(media_project)).json()
    assert any("SearXNG no responde" in w and "Docker" in w for w in body["warnings"])
    assert by_provider(body["scene"]["candidates"], "wikimedia")  # las otras siguen

    web.respond("http://127.0.0.1:8888/search", httpx.Response(403))
    body = search(client, real_scene(media_project), query="otra").json()
    assert any("formato json" in w for w in body["warnings"])


def test_image_scene_defaults_and_unsplash_key(client, media_project, web):
    image = media_project["scenes"][1]
    media = client.get(f"/api/scenes/{image}/media").json()
    # Sin clave de Unsplash, no está disponible ni por defecto.
    assert media["default_providers"] == ["pexels", "pixabay", "openverse"]
    assert "unsplash" not in media["available_providers"]

    settings = client.get("/api/settings").json()
    settings["api_keys"]["unsplash"] = "uk"
    client.put("/api/settings", json=settings)
    media = client.get(f"/api/scenes/{image}/media").json()
    assert media["default_providers"] == ["pexels", "pixabay", "unsplash", "openverse"]

    body = search(client, image, providers=["unsplash"]).json()
    [us] = body["scene"]["candidates"]
    assert us["license"] == "Unsplash License"
    assert us["author"] == "Lucía Foto"
    assert us["full_url"] == "https://images.unsplash.com/us1?ixid=x&w=1920&fm=jpg&q=85"
    req = next(r for r in web.requests if r.url.host == "api.unsplash.com")
    assert req.headers["authorization"] == "Client-ID uk"
    assert req.url.params["orientation"] == "portrait"


def test_unsplash_download_is_reported(client, media_project, web):
    image = media_project["scenes"][1]
    settings = client.get("/api/settings").json()
    settings["api_keys"]["unsplash"] = "uk"
    client.put("/api/settings", json=settings)
    [us] = search(client, image, providers=["unsplash"]).json()["scene"]["candidates"]
    # La URL de Unsplash no termina en .jpg: se responde con una imagen.
    from tests.media_support import jpeg_bytes

    web.respond(
        "https://images.unsplash.com/us1",
        httpx.Response(200, content=jpeg_bytes(), headers={"content-type": "image/jpeg"}),
    )
    job = download(client, image, [us["id"]])
    assert job["result"]["downloaded"] == 1
    ping = [r for r in web.requests if r.url.path == "/photos/us1/download"]
    assert len(ping) == 1
    assert ping[0].headers["authorization"] == "Client-ID uk"


def test_video_scene_only_uses_video_sources(client, media_project, web):
    settings = client.get("/api/settings").json()
    settings["api_keys"]["unsplash"] = "uk"
    client.put("/api/settings", json=settings)
    video = media_project["scenes"][0]
    media = client.get(f"/api/scenes/{video}/media").json()
    assert media["available_providers"] == ["pexels", "pixabay"]
    body = search(client, video, providers=["pexels", "unsplash", "openverse"]).json()
    assert {c["provider"] for c in body["scene"]["candidates"]} == {"pexels"}
    assert body["warnings"] == []


def test_real_material_downloads_keep_rights_review(client, media_project, web):
    scene = real_scene(media_project)
    candidates = search(client, scene, providers=["searxng"]).json()["scene"]["candidates"]
    job = download(client, scene, [candidates[0]["id"]])
    assert job["result"]["downloaded"] == 1
    asset = client.get(f"/api/scenes/{scene}/media").json()["candidates"][0]["asset"]
    assert asset["license"] == "Derechos: revisar"
    assert asset["source_page_url"] == "https://noticias.example/nota"


def test_no_sources_at_all(client, media_project, web):
    set_keys(client, pexels="", pixabay="")
    video = media_project["scenes"][0]
    resp = search(client, video)
    assert resp.status_code == 400
    assert "Ajustes" in resp.json()["detail"]


@pytest.mark.parametrize("provider", ["openverse", "wikimedia"])
def test_keyless_sources_rate_limit(client, media_project, web, provider):
    host = {"openverse": "https://api.openverse.org", "wikimedia": "https://commons.wikimedia.org"}[
        provider
    ]
    web.respond(host, httpx.Response(429))
    body = search(client, real_scene(media_project), providers=[provider, "searxng"]).json()
    assert any("límite de búsquedas" in w for w in body["warnings"])
    assert by_provider(body["scene"]["candidates"], "searxng")


def test_job_waiter_import_is_used():
    assert wait_job
