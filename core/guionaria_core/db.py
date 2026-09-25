"""Motor SQLite y migraciones."""

import sys
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, event
from sqlmodel import Session, create_engine

from .config import get_paths


def _migrations_dir() -> Path:
    # Con PyInstaller los datos se extraen en sys._MEIPASS.
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base / "guionaria_core" / "migrations"


def _set_sqlite_pragmas(dbapi_conn, _record) -> None:
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


@lru_cache
def _engine_for(url: str) -> Engine:
    engine = create_engine(url, connect_args={"check_same_thread": False})
    event.listen(engine, "connect", _set_sqlite_pragmas)
    return engine


def db_url() -> str:
    return f"sqlite:///{get_paths().db.as_posix()}"


def get_engine() -> Engine:
    return _engine_for(db_url())


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(_migrations_dir()))
    cfg.set_main_option("sqlalchemy.url", db_url())
    return cfg


def run_migrations() -> None:
    command.upgrade(alembic_config(), "head")
