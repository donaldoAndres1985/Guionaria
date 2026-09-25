from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .api import (
    channels,
    health,
    jobs,
    manual,
    media,
    projects,
    prompts,
    scenes,
    script,
    settings,
    voice,
)
from .config import ensure_home
from .db import run_migrations
from .security import ALLOWED_ORIGINS
from .services.errors import DomainError
from .services.jobs import fail_interrupted
from .services.prompts import ensure_prompts


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    ensure_home()
    run_migrations()
    ensure_prompts()
    fail_interrupted()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Guionaria Core", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for module in (
        health,
        settings,
        channels,
        projects,
        script,
        scenes,
        media,
        manual,
        jobs,
        prompts,
        voice,
    ):
        app.include_router(module.router)

    @app.exception_handler(DomainError)
    async def domain_error(_request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    return app


app = create_app()
