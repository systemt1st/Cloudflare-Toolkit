"""payment orders

Revision ID: 0003_payment_orders
Revises: 0002_soft_delete_and_indexes
Create Date: 2025-12-25

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0003_payment_orders"
down_revision = "0002_soft_delete_and_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payment_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=32), server_default="bepusdt", nullable=False),
        sa.Column("order_id", sa.String(length=64), nullable=False),
        sa.Column("plan_type", sa.String(length=20), nullable=False),
        sa.Column("amount_cny_cents", sa.Integer(), nullable=False),
        sa.Column("trade_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("trade_id", sa.String(length=64), nullable=True),
        sa.Column("payment_url", sa.String(length=1024), nullable=True),
        sa.Column("token", sa.String(length=255), nullable=True),
        sa.Column("actual_amount", sa.String(length=64), nullable=True),
        sa.Column("block_transaction_id", sa.String(length=128), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_notify", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name=op.f("fk_payment_orders_user_id_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payment_orders")),
        sa.UniqueConstraint("order_id", name=op.f("uq_payment_orders_order_id")),
    )
    op.create_index(op.f("ix_payment_orders_user_id"), "payment_orders", ["user_id"], unique=False)
    op.create_index(op.f("ix_payment_orders_status"), "payment_orders", ["status"], unique=False)
    op.create_index(op.f("ix_payment_orders_trade_id"), "payment_orders", ["trade_id"], unique=False)
    op.create_index("ix_payment_orders_user_created", "payment_orders", ["user_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_payment_orders_user_created", table_name="payment_orders")
    op.drop_index(op.f("ix_payment_orders_trade_id"), table_name="payment_orders")
    op.drop_index(op.f("ix_payment_orders_status"), table_name="payment_orders")
    op.drop_index(op.f("ix_payment_orders_user_id"), table_name="payment_orders")
    op.drop_table("payment_orders")
