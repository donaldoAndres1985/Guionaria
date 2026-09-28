"""investigación con fuentes: ficha estructurada en ideas y proyectos

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-28 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("idea", "project"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("research_json", sa.Text(), nullable=True))


def downgrade() -> None:
    for table in ("idea", "project"):
        with op.batch_alter_table(table) as batch:
            batch.drop_column("research_json")
