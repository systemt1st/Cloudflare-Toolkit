"""expand payment_orders.trade_id length

Revision ID: 0004_payment_orders_trade_id_255
Revises: 0003_payment_orders
Create Date: 2025-12-25

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_payment_orders_trade_id_255"
down_revision = "0003_payment_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "payment_orders",
        "trade_id",
        existing_type=sa.String(length=64),
        type_=sa.String(length=255),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "payment_orders",
        "trade_id",
        existing_type=sa.String(length=255),
        type_=sa.String(length=64),
        existing_nullable=True,
    )

