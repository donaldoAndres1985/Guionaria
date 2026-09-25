import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from guionaria_core.db import get_engine, run_migrations

EXPECTED_TABLES = {
    "channel",
    "project",
    "script_version",
    "segment",
    "scene",
    "asset",
    "scene_candidate",
    "scene_asset",
    "voice_track",
    "job",
    "search_cache",
    "publication",
    "idea",
    "operation_log",
    "project_fts",
}


@pytest.fixture
def engine(home):
    home.mkdir(parents=True)
    run_migrations()
    return get_engine()


def test_all_spec_tables_exist(engine):
    assert set(inspect(engine).get_table_names()) >= EXPECTED_TABLES


def test_migrations_are_idempotent(engine):
    run_migrations()


def test_foreign_keys_enforced(engine):
    with engine.connect() as conn, pytest.raises(IntegrityError):
        conn.execute(
            text(
                "INSERT INTO project (channel_id, title, slug, format, status, priority, "
                "folder_path, created_at, updated_at) "
                "VALUES (999, 't', 't', 'video', 'IDEA', 2, 'x', '', '')"
            )
        )


def test_project_format_check(engine):
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO channel (name, slug, platforms, language, words_per_second, "
                "created_at, updated_at) VALUES ('C', 'c', '[]', 'es', 2.5, '', '')"
            )
        )
    with engine.connect() as conn, pytest.raises(IntegrityError):
        conn.execute(
            text(
                "INSERT INTO project (channel_id, title, slug, format, status, priority, "
                "folder_path, created_at, updated_at) "
                "VALUES (1, 't', 't', 'podcast', 'IDEA', 2, 'x', '', '')"
            )
        )


def test_fts5_search(engine):
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO project_fts (title, topic, script_text, tags) "
                "VALUES ('El secuestro', 'caso real', 'Esto no es una película', 'crimen')"
            )
        )
        hits = conn.execute(
            text("SELECT title FROM project_fts WHERE project_fts MATCH 'película'")
        ).all()
    assert hits == [("El secuestro",)]
