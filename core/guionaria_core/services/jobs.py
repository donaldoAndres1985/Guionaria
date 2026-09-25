"""Cola de trabajos en segundo plano (tabla `job` + asyncio, sin Redis).

Cada cambio de un trabajo se publica a los suscriptores (WebSocket /ws/jobs) para que la UI
muestre el progreso en vivo.
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_engine
from ..models import Job
from ..models._base import now_iso
from .errors import Conflict, DomainError, NotFound

log = logging.getLogger(__name__)

ACTIVE = ("queued", "running")


class JobRead(BaseModel):
    id: int
    type: str
    project_id: int | None
    status: str
    progress: float
    message: str | None
    result: Any | None
    error: str | None
    created_at: str
    finished_at: str | None


def to_read(job: Job) -> JobRead:
    return JobRead(
        id=job.id,
        type=job.type,
        project_id=job.project_id,
        status=job.status or "queued",
        progress=job.progress or 0.0,
        message=job.message,
        result=json.loads(job.result) if job.result else None,
        error=job.error,
        created_at=job.created_at,
        finished_at=job.finished_at,
    )


class JobContext:
    """Lo que recibe la función del trabajo para informar progreso."""

    def __init__(self, manager: "JobManager", job_id: int):
        self._manager = manager
        self.job_id = job_id

    def progress(self, progress: float, message: str | None = None) -> None:
        self._manager.update(self.job_id, progress=progress, message=message)


JobFn = Callable[[JobContext], Awaitable[Any]]


class JobManager:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[JobRead]] = set()
        self._tasks: set[asyncio.Task[None]] = set()

    # --- suscripción (WebSocket) ---

    def subscribe(self) -> asyncio.Queue[JobRead]:
        queue: asyncio.Queue[JobRead] = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[JobRead]) -> None:
        self._subscribers.discard(queue)

    def _publish(self, job: JobRead) -> None:
        for queue in self._subscribers:
            queue.put_nowait(job)

    # --- ciclo de vida ---

    def submit(
        self,
        job_type: str,
        fn: JobFn,
        project_id: int | None = None,
        payload: dict[str, Any] | None = None,
        exclusive: bool = True,
    ) -> JobRead:
        """Registra el trabajo y lo lanza en el event loop actual.

        exclusive: rechaza el trabajo si ya hay otro activo del mismo tipo para el proyecto.
        """
        with Session(get_engine()) as session:
            if exclusive and project_id is not None:
                busy = session.exec(
                    select(Job).where(
                        Job.type == job_type,
                        Job.project_id == project_id,
                        Job.status.in_(ACTIVE),
                    )
                ).first()
                if busy:
                    raise Conflict("Ya hay un trabajo igual en curso para este proyecto")
            job = Job(
                type=job_type,
                project_id=project_id,
                payload=json.dumps(payload, ensure_ascii=False) if payload else None,
                status="queued",
                progress=0.0,
            )
            session.add(job)
            session.commit()
            session.refresh(job)
            read = to_read(job)

        task = asyncio.get_running_loop().create_task(self._run(read.id, fn))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        self._publish(read)
        return read

    def update(self, job_id: int, **fields: Any) -> JobRead:
        with Session(get_engine()) as session:
            job = session.get(Job, job_id)
            if not job:
                raise NotFound("El trabajo no existe")
            for key, value in fields.items():
                if key == "result":
                    value = json.dumps(value, ensure_ascii=False) if value is not None else None
                if value is not None or key in ("error", "result"):
                    setattr(job, key, value)
            session.commit()
            session.refresh(job)
            read = to_read(job)
        self._publish(read)
        return read

    async def _run(self, job_id: int, fn: JobFn) -> None:
        self.update(job_id, status="running", progress=0.02)
        try:
            result = await fn(JobContext(self, job_id))
        except DomainError as exc:
            self.update(job_id, status="failed", error=exc.message, finished_at=now_iso())
        except Exception as exc:  # error inesperado: se registra y se informa
            log.exception("Trabajo %s falló", job_id)
            self.update(
                job_id, status="failed", error=f"Error inesperado: {exc}", finished_at=now_iso()
            )
        else:
            self.update(job_id, status="done", progress=1.0, result=result, finished_at=now_iso())

    async def wait_all(self) -> None:
        """Espera a que terminen los trabajos en curso (útil en tests)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)


def fail_interrupted() -> int:
    """Al arrancar: los trabajos que quedaron activos se cortaron al cerrar la app."""
    with Session(get_engine()) as session:
        jobs = session.exec(select(Job).where(Job.status.in_(ACTIVE))).all()
        for job in jobs:
            job.status = "failed"
            job.error = "La app se cerró mientras el trabajo estaba en curso."
            job.finished_at = now_iso()
        session.commit()
        return len(jobs)


def get_job(job_id: int) -> JobRead:
    with Session(get_engine()) as session:
        job = session.get(Job, job_id)
        if not job:
            raise NotFound("El trabajo no existe")
        return to_read(job)


def list_jobs(project_id: int | None = None, active: bool = False) -> list[JobRead]:
    with Session(get_engine()) as session:
        stmt = select(Job).order_by(Job.id.desc()).limit(50)
        if project_id is not None:
            stmt = stmt.where(Job.project_id == project_id)
        if active:
            stmt = stmt.where(Job.status.in_(ACTIVE))
        return [to_read(j) for j in session.exec(stmt).all()]


jobs = JobManager()
