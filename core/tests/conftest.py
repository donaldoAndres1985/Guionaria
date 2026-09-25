import time

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("GUIONARIA_HOME", str(tmp_path / "Guionaria"))
    return tmp_path / "Guionaria"


@pytest.fixture
def client(home):
    from guionaria_core.main import create_app

    with TestClient(create_app()) as c:
        yield c


class FakeClaude:
    """Reemplaza a la CLI real: devuelve respuestas encoladas y registra cada llamada."""

    def __init__(self):
        self.responses = []
        self.calls = []

    def queue(self, *responses):
        self.responses.extend(responses)

    async def run(self, prompt, schema, cwd=None):
        self.calls.append({"prompt": prompt, "schema": schema, "cwd": cwd})
        if not self.responses:
            raise AssertionError("FakeClaude: no hay respuestas encoladas")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


@pytest.fixture
def fake_claude(monkeypatch):
    from guionaria_core.services.llm import claude_cli

    fake = FakeClaude()
    monkeypatch.setattr(claude_cli, "runner_factory", lambda: fake)
    return fake


def wait_job(client, job_id, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "failed"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"El trabajo {job_id} no terminó en {timeout}s")


@pytest.fixture
def channel(client):
    return client.post(
        "/api/channels",
        json={
            "name": "Casos Reales",
            "platforms": ["youtube"],
            "style_prompt": "Sobrio y respetuoso.",
            "script_template": "Gancho, Contexto, Cierre",
            "words_per_second": 2.0,
        },
    ).json()


@pytest.fixture
def project(client, channel):
    return client.post(
        "/api/projects",
        json={
            "channel_id": channel["id"],
            "title": "El secuestro",
            "format": "reel",
            "topic": "Caso Priscila",
            "research_notes": "Ocurrió en 2008 en CDMX.",
        },
    ).json()
