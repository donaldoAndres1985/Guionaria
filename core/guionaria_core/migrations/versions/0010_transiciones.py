"""transiciones entre escenas: la de cada corte (hacia la escena siguiente)

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-28 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("scene") as batch:
        batch.add_column(sa.Column("transition", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("scene") as batch:
        batch.drop_column("transition")
