"""publicación: metadatos por plataforma, interruptor «publicar en» y fechas

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-28 15:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("publication") as batch:
        batch.add_column(sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"))
        batch.add_column(sa.Column("meta_json", sa.Text(), nullable=True))
        batch.add_column(sa.Column("created_at", sa.String(), nullable=True))
        batch.add_column(sa.Column("updated_at", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("publication") as batch:
        for column in ("updated_at", "created_at", "meta_json", "enabled"):
            batch.drop_column(column)
