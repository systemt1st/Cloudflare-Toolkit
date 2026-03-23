"""init

Revision ID: 0001_init
Revises: 
Create Date: 2025-12-17

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("nickname", sa.String(length=50), nullable=False),
        sa.Column("google_id", sa.String(length=255), nullable=True),
        sa.Column("subscription_status", sa.String(length=20), server_default="free", nullable=False),
        sa.Column("credits", sa.Integer(), server_default="1000", nullable=False),
        sa.Column("credits_reset_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)
    op.create_index(op.f("ix_users_google_id"), "users", ["google_id"], unique=False)

    op.create_table(
        "cf_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("credential_type", sa.String(length=20), nullable=False),
        sa.Column("encrypted_credentials", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name=op.f("fk_cf_accounts_user_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cf_accounts")),
    )
    op.create_index(op.f("ix_cf_accounts_user_id"), "cf_accounts", ["user_id"], unique=False)

    op.create_table(
        "subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_type", sa.String(length=20), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("payment_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name=op.f("fk_subscriptions_user_id_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_subscriptions")),
    )
    op.create_index(op.f("ix_subscriptions_user_id"), "subscriptions", ["user_id"], unique=False)
    op.create_index(op.f("ix_subscriptions_status"), "subscriptions", ["status"], unique=False)

    op.create_table(
        "operation_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operation_type", sa.String(length=50), nullable=False),
        sa.Column("target_domain", sa.String(length=255), nullable=True),
        sa.Column("result", sa.String(length=20), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name=op.f("fk_operation_logs_user_id_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_operation_logs")),
    )
    op.create_index(op.f("ix_operation_logs_user_id"), "operation_logs", ["user_id"], unique=False)
    op.create_index(op.f("ix_operation_logs_created_at"), "operation_logs", ["created_at"], unique=False)

    op.create_table(
        "domain_caches",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=False),
        sa.Column("zone_id", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("name_servers", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("cached_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["cf_accounts.id"],
            ondelete="CASCADE",
            name=op.f("fk_domain_caches_account_id_cf_accounts"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_domain_caches")),
        sa.UniqueConstraint("account_id", "domain", name="uq_domain_cache_account_domain"),
    )
    op.create_index(op.f("ix_domain_caches_account_id"), "domain_caches", ["account_id"], unique=False)
    op.create_index(op.f("ix_domain_caches_status"), "domain_caches", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_domain_caches_status"), table_name="domain_caches")
    op.drop_index(op.f("ix_domain_caches_account_id"), table_name="domain_caches")
    op.drop_table("domain_caches")

    op.drop_index(op.f("ix_operation_logs_created_at"), table_name="operation_logs")
    op.drop_index(op.f("ix_operation_logs_user_id"), table_name="operation_logs")
    op.drop_table("operation_logs")

    op.drop_index(op.f("ix_subscriptions_status"), table_name="subscriptions")
    op.drop_index(op.f("ix_subscriptions_user_id"), table_name="subscriptions")
    op.drop_table("subscriptions")

    op.drop_index(op.f("ix_cf_accounts_user_id"), table_name="cf_accounts")
    op.drop_table("cf_accounts")

    op.drop_index(op.f("ix_users_google_id"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")

