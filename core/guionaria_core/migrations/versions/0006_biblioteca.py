"""biblioteca: hash SHA-256 del archivo y medio reutilizado de otro proyecto

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-26 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("asset") as batch:
        batch.add_column(sa.Column("sha256", sa.String(), nullable=True))
        batch.add_column(sa.Column("reused_from_id", sa.Integer(), nullable=True))
    op.create_index("ix_asset_sha256", "asset", ["sha256"])


def downgrade() -> None:
    op.drop_index("ix_asset_sha256", table_name="asset")
    with op.batch_alter_table("asset") as batch:
        batch.drop_column("reused_from_id")
        batch.drop_column("sha256")
