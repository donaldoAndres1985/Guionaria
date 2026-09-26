"""papelera de proyectos (30 días) e índice del historial

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-26 15:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("project") as batch:
        batch.add_column(sa.Column("deleted_at", sa.String(), nullable=True))
        batch.add_column(sa.Column("trash_path", sa.String(), nullable=True))
    op.create_index("ix_operation_log_at", "operation_log", ["at"])


def downgrade() -> None:
    op.drop_index("ix_operation_log_at", table_name="operation_log")
    with op.batch_alter_table("project") as batch:
        batch.drop_column("trash_path")
        batch.drop_column("deleted_at")
