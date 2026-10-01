"""pistas manuales del timeline (textos y SFX) y duración de la transición por corte

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-01 01:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "timeline_track",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index("ix_timeline_track_project_id", "timeline_track", ["project_id"])
    op.create_table(
        "timeline_item",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("track_id", sa.Integer(), sa.ForeignKey("timeline_track.id"), nullable=False),
        sa.Column("start_s", sa.Float(), nullable=False),
        sa.Column("duration_s", sa.Float(), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("style_json", sa.Text(), nullable=True),
        sa.Column("sound_id", sa.Integer(), sa.ForeignKey("sound.id"), nullable=True),
        sa.Column("volume", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("fade_in_s", sa.Float(), nullable=False, server_default="0"),
        sa.Column("fade_out_s", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index("ix_timeline_item_track_id", "timeline_item", ["track_id"])
    with op.batch_alter_table("scene") as batch:
        batch.add_column(sa.Column("transition_s", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("scene") as batch:
        batch.drop_column("transition_s")
    op.drop_index("ix_timeline_item_track_id", "timeline_item")
    op.drop_table("timeline_item")
    op.drop_index("ix_timeline_track_project_id", "timeline_track")
    op.drop_table("timeline_track")
