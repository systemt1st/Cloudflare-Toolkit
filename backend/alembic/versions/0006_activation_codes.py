"""activation codes

Revision ID: 0006_activation_codes
Revises: 0005_payment_orders_amount_cur
Create Date: 2026-01-06

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0006_activation_codes"
down_revision = "0005_payment_orders_amount_cur"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activation_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=128), nullable=False),
        sa.Column("plan_type", sa.String(length=20), server_default="yearly", nullable=False),
        sa.Column("days", sa.Integer(), server_default="365", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("redeemed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["redeemed_by"],
            ["users.id"],
            ondelete="SET NULL",
            name=op.f("fk_activation_codes_redeemed_by_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activation_codes")),
        sa.UniqueConstraint("code", name=op.f("uq_activation_codes_code")),
    )
    op.create_index(op.f("ix_activation_codes_code"), "activation_codes", ["code"], unique=False)
    op.create_index(op.f("ix_activation_codes_redeemed_by"), "activation_codes", ["redeemed_by"], unique=False)
    op.create_index(op.f("ix_activation_codes_redeemed_at"), "activation_codes", ["redeemed_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_activation_codes_redeemed_at"), table_name="activation_codes")
    op.drop_index(op.f("ix_activation_codes_redeemed_by"), table_name="activation_codes")
    op.drop_index(op.f("ix_activation_codes_code"), table_name="activation_codes")
    op.drop_table("activation_codes")
