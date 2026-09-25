"""ideas: proyecto al que se convirtió y fecha de actualización

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-26 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("idea") as batch:
        batch.add_column(sa.Column("project_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("updated_at", sa.String(), nullable=True))
        batch.create_foreign_key("fk_idea_project", "project", ["project_id"], ["id"])
    op.create_index("ix_idea_channel_status", "idea", ["channel_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_idea_channel_status", table_name="idea")
    with op.batch_alter_table("idea") as batch:
        batch.drop_constraint("fk_idea_project", type_="foreignkey")
        batch.drop_column("updated_at")
        batch.drop_column("project_id")
