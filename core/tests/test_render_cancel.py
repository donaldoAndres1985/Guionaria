"""Cancelar el render y niveles de calidad."""

import asyncio
import shutil
import threading
import time

import pytest

from guionaria_core.services import jobs as jobs_svc
from guionaria_core.services.jobs import JobCancelled, jobs
from guionaria_core.services.render import plan
from guionaria_core.services.render import service as render
from tests.conftest import wait_job

HAS_FFMPEG = shutil.which("ffmpeg") is not None


def test_quality_levels():
    assert plan.quality(1080, 1920, "draft").size == "720x1280"
    std = plan.quality(1080, 1920, "standard")
    assert (std.size, std.preset, std.crf, std.audio_bitrate) == ("1080x1920", "faster", 20, "192k")
    high = plan.quality(1080, 1920, "high")
    assert (high.size, high.preset, high.crf, high.audio_bitrate) == (
        "1080x1920",
        "slow",
        17,
        "256k",
    )
    top = plan.quality(1920, 1080, "max")
    assert (top.size, top.crf) == ("3840x2160", 17)
    assert plan.quality(1080, 1920, "max").size == "2160x3840"
    # Compatibilidad con draft=True/False.
    assert plan.quality(1920, 1080, True).size == "1280x720"
    assert plan.quality(1920, 1080, False).size == "1920x1080"


@pytest.mark.skipif(not HAS_FFMPEG, reason="requiere FFmpeg")
def test_ffmpeg_is_killed_when_cancelled(tmp_path):
    cancel = threading.Event()
    # -re lee a velocidad real: sin cancelar tardaría 30 s.
    args = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=160x90:rate=10",
        "-t",
        "30",
        "-f",
        "null",
        "-",
    ]
    threading.Timer(0.5, cancel.set).start()
    start = time.monotonic()
    with pytest.raises(JobCancelled):
        render._run(args, cwd=tmp_path, cancel=cancel)
    assert time.monotonic() - start < 5


def test_cancel_a_running_job(client, project):
    started = asyncio.Event()

    async def work(ctx):
        started.set()
        while True:
            ctx.check_cancelled()
            await asyncio.sleep(0.05)

    async def submit():
        return jobs.submit("render", work, project_id=project["id"])

    job = client.portal.call(submit)  # en el event loop de la app
    resp = client.post(f"/api/jobs/{job.id}:cancel")
    assert resp.status_code == 200, resp.text
    done = wait_job(client, job.id)
    assert done["status"] == "cancelled"
    assert done["message"] == "Cancelado"
    assert done["cancellable"] is False
    # Ya terminado: no se puede cancelar otra vez.
    assert client.post(f"/api/jobs/{job.id}:cancel").status_code == 409


def test_only_cancellable_types(client, project):
    async def work(ctx):
        await asyncio.sleep(0.3)
        return {}

    async def submit():
        return jobs.submit("voice", work, project_id=project["id"])

    job = client.portal.call(submit)
    assert job.cancellable is False
    assert client.post(f"/api/jobs/{job.id}:cancel").status_code == 409
    wait_job(client, job.id)


def test_orphan_active_job_is_marked_cancelled(client, project):
    from sqlmodel import Session

    from guionaria_core.db import get_engine
    from guionaria_core.models import Job

    with Session(get_engine()) as session:
        job = Job(type="render", project_id=project["id"], status="running", progress=0.3)
        session.add(job)
        session.commit()
        job_id = job.id
    assert jobs_svc.get_job(job_id).cancellable is True
    resp = client.post(f"/api/jobs/{job_id}:cancel")
    assert resp.json()["status"] == "cancelled"


# --- escenas en paralelo y codificador de la GPU ---


def test_segments_run_in_parallel_and_report(monkeypatch):
    running, peak, seen = [0], [0], []
    lock = threading.Lock()

    def fake_run(args, cwd=None, cancel=None):
        with lock:
            running[0] += 1
            peak[0] = max(peak[0], running[0])
        time.sleep(0.05)
        with lock:
            running[0] -= 1
            seen.append(args[0])

    monkeypatch.setattr(render, "_run", fake_run)
    monkeypatch.setattr(render, "segment_workers", lambda: 3)
    messages = []
    render._run_segments([[f"s{i}"] for i in range(6)], lambda f, m: messages.append(m), None)
    assert sorted(seen) == [f"s{i}" for i in range(6)] and peak[0] > 1
    assert messages[-1] == "Escena 6 de 6…"


def test_failed_segment_stops_the_rest(monkeypatch):
    started = []

    def fake_run(args, cwd=None, cancel=None):
        started.append(args[0])
        if args[0] == "s0":
            raise render.DomainError("FFmpeg falló: s0")
        for _ in range(100):  # las demás esperan hasta que las detienen
            if cancel.is_set():
                raise JobCancelled()
            time.sleep(0.01)

    monkeypatch.setattr(render, "_run", fake_run)
    monkeypatch.setattr(render, "segment_workers", lambda: 2)
    start = time.monotonic()
    with pytest.raises(render.DomainError, match="s0"):
        render._run_segments([[f"s{i}"] for i in range(4)], lambda *a: None, None)
    assert time.monotonic() - start < 0.5


def test_cancel_stops_parallel_segments(monkeypatch):
    cancel = threading.Event()

    def fake_run(args, cwd=None, cancel=None):
        while not cancel.is_set():
            time.sleep(0.01)
        raise JobCancelled()

    monkeypatch.setattr(render, "_run", fake_run)
    threading.Timer(0.1, cancel.set).start()
    with pytest.raises(JobCancelled):
        render._run_segments([["a"], ["b"], ["c"]], lambda *a: None, cancel)


def test_gpu_failure_falls_back_to_x264(monkeypatch):
    monkeypatch.setattr(render, "hardware_encoder", lambda: "h264_qsv")
    monkeypatch.setattr(render, "_hardware_failed", False)
    calls = []

    def fake_pass(*args, hardware=None):
        calls.append(hardware)
        if hardware:
            raise render.DomainError("FFmpeg falló: qsv")
        return "video", None

    monkeypatch.setattr(render, "_render_pass", fake_pass)

    class M:
        width, height = 1920, 1080

    assert render._render_sync(M(), None, None, "standard", lambda *a: None) == ("video", None)
    assert calls == ["h264_qsv", None] and render._hardware_failed
    calls.clear()  # alta calidad: siempre x264, sin probar la GPU
    render._render_sync(M(), None, None, "high", lambda *a: None)
    assert calls == [None]
