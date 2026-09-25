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
