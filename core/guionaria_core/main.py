from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api import health, settings
from .config import ensure_home
from .db import run_migrations

# Orígenes del webview de Tauri (Windows usa http://tauri.localhost) y del dev server de Vite.
ALLOWED_ORIGINS = [
    "http://localhost:1420",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    ensure_home()
    run_migrations()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Guionaria Core", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(settings.router)
    return app


app = create_app()
