"""payment orders amount currency

Revision ID: 0005_payment_orders_amount_cur
Revises: 0004_payment_orders_trade_id_255
Create Date: 2025-12-31

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_payment_orders_amount_cur"
down_revision = "0004_payment_orders_trade_id_255"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("payment_orders", "amount_cny_cents", new_column_name="amount_cents")
    op.add_column(
        "payment_orders",
        sa.Column("amount_currency", sa.String(length=8), server_default="cny", nullable=False),
    )
    op.execute("UPDATE payment_orders SET amount_currency = 'usd' WHERE provider = 'stripe'")


def downgrade() -> None:
    op.drop_column("payment_orders", "amount_currency")
    op.alter_column("payment_orders", "amount_cents", new_column_name="amount_cny_cents")
