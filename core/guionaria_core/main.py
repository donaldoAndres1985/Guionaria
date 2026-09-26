from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .api import (
    channels,
    health,
    history,
    ideas,
    integrations,
    jobs,
    library,
    manual,
    media,
    projects,
    prompts,
    render,
    scenes,
    script,
    settings,
    sounds,
    storage,
    timeline,
    voice,
)
from .config import ensure_home
from .db import run_migrations
from .mcp_server import build_mcp, transport_security
from .security import ALLOWED_ORIGINS
from .services.errors import DomainError
from .services.jobs import fail_interrupted
from .services.prompts import ensure_prompts


def _purge_expired_trash() -> None:
    """Al iniciar: borra lo que lleva más de 30 días en la papelera."""
    from sqlmodel import Session

    from .db import get_engine
    from .services.trash import purge_expired

    with Session(get_engine()) as session:
        purge_expired(session)


def create_app() -> FastAPI:
    # Servidor MCP por HTTP en /mcp (sección 4.2): sin estado y con respuestas JSON, que es lo
    # más simple para clientes locales como Claude Code.
    mcp = build_mcp()
    mcp_app = mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        transport_security=transport_security(),
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        ensure_home()
        run_migrations()
        ensure_prompts()
        fail_interrupted()
        _purge_expired_trash()
        async with mcp.session_manager.run():
            yield

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
        timeline,
        integrations,
        ideas,
        library,
        storage,
        history,
        sounds,
        render,
    ):
        app.include_router(module.router)
    app.router.routes.extend(mcp_app.routes)

    @app.exception_handler(DomainError)
    async def domain_error(_request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    return app


app = create_app()
