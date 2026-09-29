"""origen del proyecto: hecho en Guionaria o video terminado importado (CapCut u otro editor)

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-28 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("project") as batch:
        batch.add_column(
            sa.Column("origin", sa.String(), nullable=False, server_default="guionaria")
        )


def downgrade() -> None:
    with op.batch_alter_table("project") as batch:
        batch.drop_column("origin")
