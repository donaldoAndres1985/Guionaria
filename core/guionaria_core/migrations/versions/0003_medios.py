"""medios: tipo y vista previa del candidato; archivo del medio aprobado

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-25 14:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("scene_candidate") as batch:
        batch.add_column(sa.Column("kind", sa.String(), nullable=False, server_default="image"))
        batch.add_column(sa.Column("video_preview_url", sa.String(), nullable=True))
    with op.batch_alter_table("scene_asset") as batch:
        batch.add_column(sa.Column("file_path", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("scene_asset") as batch:
        batch.drop_column("file_path")
    with op.batch_alter_table("scene_candidate") as batch:
        batch.drop_column("video_preview_url")
        batch.drop_column("kind")
