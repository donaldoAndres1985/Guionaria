"""Verificación de claves de API desde Ajustes (sin llamadas reales: MockTransport)."""

import httpx
import pytest

from guionaria_core.services.media import http as media_http


class FakeProviders:
    """Responde como cada proveedor y registra las peticiones."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.status = 200
        self.body = b"{}"
        self.headers: dict[str, str] = {}
        self.fail = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail:
            raise httpx.ConnectError("sin red", request=request)
        return httpx.Response(self.status, content=self.body, headers=self.headers)


@pytest.fixture
def providers(monkeypatch):
    fake = FakeProviders()
    monkeypatch.setattr(
        media_http,
        "client_factory",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)),
    )
    return fake


def probe(client, provider, value=None):
    resp = client.post(f"/api/settings/keys/{provider}:test", json={"value": value})
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.parametrize(
    ("provider", "host", "check"),
    [
        ("pexels", "api.pexels.com", lambda r: r.headers["Authorization"] == "k-123"),
        ("pixabay", "pixabay.com", lambda r: r.url.params["key"] == "k-123"),
        ("unsplash", "api.unsplash.com", lambda r: r.headers["Authorization"] == "Client-ID k-123"),
        ("freesound", "freesound.org", lambda r: r.url.params["token"] == "k-123"),
    ],
)
def test_valid_key_sends_credentials_and_reports_quota(client, providers, provider, host, check):
    providers.headers = {"X-Ratelimit-Remaining": "187"}
    result = probe(client, provider, "  k-123 ")
    assert result["status"] == "valid"
    assert result["quota_remaining"] == 187
    assert result["latency_ms"] is not None
    req = providers.requests[0]
    assert req.url.host == host
    assert check(req)


def test_rejected_key(client, providers):
    providers.status = 401
    result = probe(client, "pexels", "mala")
    assert result["status"] == "invalid"
    assert "rechazó la clave" in result["message"]
    assert result["quota_remaining"] is None


def test_pixabay_invalid_key_is_a_400(client, providers):
    providers.status = 400
    providers.body = b"[ERROR 400] Invalid or missing API key"
    assert probe(client, "pixabay", "mala")["status"] == "invalid"


def test_rate_limited(client, providers):
    providers.status = 429
    providers.headers = {"X-Ratelimit-Remaining": "0"}
    result = probe(client, "unsplash", "k")
    assert result["status"] == "rate_limited"
    assert result["quota_remaining"] == 0


def test_other_errors_and_no_network(client, providers):
    providers.status = 500
    assert probe(client, "freesound", "k")["status"] == "error"
    providers.fail = True
    result = probe(client, "freesound", "k")
    assert result["status"] == "unreachable"
    assert "no responde" in result["message"]


def test_missing_key_does_not_call_the_provider(client, providers):
    result = probe(client, "pexels")
    assert result["status"] == "missing"
    assert providers.requests == []


def test_without_value_uses_saved_key(client, providers):
    settings = client.get("/api/settings").json()
    settings["api_keys"]["pixabay"] = "guardada"
    client.put("/api/settings", json=settings)
    assert probe(client, "pixabay")["status"] == "valid"
    assert providers.requests[0].url.params["key"] == "guardada"


def test_searxng_url(client, providers):
    result = probe(client, "searxng", "http://127.0.0.1:9999/")
    assert result["status"] == "valid"
    req = providers.requests[0]
    assert str(req.url).startswith("http://127.0.0.1:9999/search")
    assert req.url.params["format"] == "json"

    providers.status = 403
    result = probe(client, "searxng", "http://127.0.0.1:9999")
    assert result["status"] == "error"
    assert "formato json" in result["message"]

    providers.fail = True
    assert (
        "en http://127.0.0.1:9999" in probe(client, "searxng", "http://127.0.0.1:9999")["message"]
    )


def test_unknown_provider(client, providers):
    resp = client.post("/api/settings/keys/flickr:test", json={"value": "x"})
    assert resp.status_code == 404
