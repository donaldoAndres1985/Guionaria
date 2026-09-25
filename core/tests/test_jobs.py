import asyncio

import pytest
from sqlmodel import Session
from starlette.websockets import WebSocketDisconnect

from guionaria_core.db import get_engine, run_migrations
from guionaria_core.models import Job
from guionaria_core.services.errors import Conflict, DomainError
from guionaria_core.services.jobs import JobManager, fail_interrupted, get_job, list_jobs


@pytest.fixture
def db(home):
    home.mkdir(parents=True)
    run_migrations()


def run_jobs(*submissions):
    """Ejecuta los trabajos en un event loop propio y devuelve (jobs, eventos publicados)."""

    async def main():
        manager = JobManager()
        events = manager.subscribe()
        submitted = [manager.submit(*args, **kwargs) for args, kwargs in submissions]
        await manager.wait_all()
        published = []
        while not events.empty():
            published.append(events.get_nowait())
        return [get_job(j.id) for j in submitted], published

    return asyncio.run(main())


def test_successful_job_reports_progress_and_result(db):
    async def work(ctx):
        ctx.progress(0.5, "a mitad")
        return {"ok": True}

    [job], events = run_jobs((("demo", work), {"project_id": 1}))
    assert job.status == "done"
    assert job.progress == 1.0
    assert job.result == {"ok": True}
    assert job.finished_at
    assert [e.status for e in events] == ["queued", "running", "running", "done"]
    assert events[2].message == "a mitad"


def test_domain_error_marks_failed_with_message(db):
    async def work(ctx):
        raise DomainError("Claude no respondió")

    [job], _ = run_jobs((("demo", work), {}))
    assert job.status == "failed"
    assert job.error == "Claude no respondió"


def test_unexpected_error_marks_failed(db):
    async def work(ctx):
        raise RuntimeError("boom")

    [job], _ = run_jobs((("demo", work), {}))
    assert job.status == "failed"
    assert "boom" in job.error


def test_exclusive_jobs_per_project(db):
    async def main():
        manager = JobManager()

        async def slow(ctx):
            await asyncio.sleep(0.05)

        manager.submit("demo", slow, project_id=7)
        with pytest.raises(Conflict):
            manager.submit("demo", slow, project_id=7)
        manager.submit("demo", slow, project_id=8)  # otro proyecto: permitido
        manager.submit("otro", slow, project_id=7)  # otro tipo: permitido
        await manager.wait_all()

    asyncio.run(main())
    assert len(list_jobs()) == 3
    assert list_jobs(project_id=7, active=True) == []


def test_interrupted_jobs_fail_on_startup(db):
    with Session(get_engine()) as s:
        s.add(Job(type="demo", status="running"))
        s.add(Job(type="demo", status="done"))
        s.commit()
    assert fail_interrupted() == 1
    statuses = sorted(j.status for j in list_jobs())
    assert statuses == ["done", "failed"]


def test_jobs_api_and_websocket(client, fake_claude, project):
    from tests.conftest import wait_job

    fake_claude.queue(
        {"titulo_tentativo": "T", "segmentos": [{"seccion": "gancho", "texto": "Hola."}]}
    )
    with client.websocket_connect("/ws/jobs") as ws:
        job = client.post(f"/api/projects/{project['id']}/script:generate").json()
        seen = []
        while not seen or seen[-1]["status"] not in ("done", "failed"):
            seen.append(ws.receive_json())
    assert seen[-1]["id"] == job["id"]
    assert seen[-1]["status"] == "done"
    assert wait_job(client, job["id"])["result"]["segments"] == 1
    assert client.get(f"/api/jobs?project_id={project['id']}").json()[0]["id"] == job["id"]
    assert client.get("/api/jobs/9999").status_code == 404


def test_websocket_rejects_foreign_origin(client):
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect("/ws/jobs", headers={"origin": "https://evil.example"}) as ws,
    ):
        ws.receive_text()
