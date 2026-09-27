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
    assert (std.size, std.preset, std.crf, std.audio_bitrate) == ("1080x1920", "medium", 20, "192k")
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
