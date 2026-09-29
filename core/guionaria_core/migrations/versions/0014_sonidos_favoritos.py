"""sonidos favoritos por canal (listado de audios con su atribución, para cualquier canal)

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-29 14:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("sound") as batch:
        batch.add_column(sa.Column("favorite_channels", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sound") as batch:
        batch.drop_column("favorite_channels")
