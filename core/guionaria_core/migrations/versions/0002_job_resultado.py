"""job: resultado y mensaje de progreso

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-25 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("job") as batch:
        batch.add_column(sa.Column("message", sa.String(), nullable=True))
        batch.add_column(sa.Column("result", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("job") as batch:
        batch.drop_column("result")
        batch.drop_column("message")
