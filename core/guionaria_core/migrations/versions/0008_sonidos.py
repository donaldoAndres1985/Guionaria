"""sonidos: biblioteca de SFX y música, y sonidos asignados a cada escena

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-26 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sound",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("file_path", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=True),
        sa.Column("source_url", sa.String(), nullable=True),
        sa.Column("author", sa.String(), nullable=True),
        sa.Column("license", sa.String(), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("tags", sa.String(), nullable=True),
        sa.Column("mood", sa.String(), nullable=True),
        sa.Column("bpm", sa.Integer(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.CheckConstraint("kind IN ('sfx','music')", name="ck_sound_kind"),
    )
    op.create_index("ix_sound_kind", "sound", ["kind"])
    with op.batch_alter_table("scene") as batch:
        batch.add_column(sa.Column("sfx_sound_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("music_sound_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("scene") as batch:
        batch.drop_column("music_sound_id")
        batch.drop_column("sfx_sound_id")
    op.drop_index("ix_sound_kind", table_name="sound")
    op.drop_table("sound")
