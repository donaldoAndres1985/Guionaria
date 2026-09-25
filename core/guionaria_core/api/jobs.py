from typing import Annotated

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..security import origin_allowed
from ..services import jobs as svc

router = APIRouter(tags=["jobs"])


@router.get("/api/jobs", response_model=list[svc.JobRead])
def list_jobs(
    project_id: Annotated[int | None, Query()] = None,
    active: Annotated[bool, Query()] = False,
) -> list[svc.JobRead]:
    return svc.list_jobs(project_id=project_id, active=active)


@router.get("/api/jobs/{job_id}", response_model=svc.JobRead)
def get_job(job_id: int) -> svc.JobRead:
    return svc.get_job(job_id)


@router.websocket("/ws/jobs")
async def jobs_socket(ws: WebSocket) -> None:
    """Envía cada cambio de un trabajo como JSON (JobRead)."""
    if not origin_allowed(ws.headers.get("origin")):
        await ws.close(code=1008)  # policy violation
        return
    await ws.accept()
    queue = svc.jobs.subscribe()
    try:
        while True:
            job = await queue.get()
            await ws.send_text(job.model_dump_json())
    except WebSocketDisconnect:
        pass
    finally:
        svc.jobs.unsubscribe(queue)
