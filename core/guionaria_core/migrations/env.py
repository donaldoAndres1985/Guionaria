from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from guionaria_core import models  # noqa: F401  (registra las tablas en el metadata)
from guionaria_core.db import db_url

config = context.config
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", db_url())

target_metadata = SQLModel.metadata


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    # project_fts (FTS5) y sus tablas internas se gestionan con SQL directo.
    return not (type_ == "table" and name.startswith("project_fts"))


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # render_as_batch: SQLite no soporta ALTER TABLE completo.
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
