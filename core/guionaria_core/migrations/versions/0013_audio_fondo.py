"""audio de fondo en bucle por proyecto y atribución de los sonidos

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-29 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("project") as batch:
        batch.add_column(sa.Column("background_json", sa.Text(), nullable=True))
    with op.batch_alter_table("sound") as batch:
        batch.add_column(sa.Column("attribution", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sound") as batch:
        batch.drop_column("attribution")
    with op.batch_alter_table("project") as batch:
        batch.drop_column("background_json")
