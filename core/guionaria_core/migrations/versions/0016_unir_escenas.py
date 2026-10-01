"""escenas que cubren varios segmentos seguidos («Unir con la siguiente»)

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-01 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("scene") as batch:
        batch.add_column(sa.Column("joined_seg_keys", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("scene") as batch:
        batch.drop_column("joined_seg_keys")
