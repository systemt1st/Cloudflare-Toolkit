"""soft delete and indexes

Revision ID: 0002_soft_delete_and_indexes
Revises: 0001_init
Create Date: 2025-12-18

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_soft_delete_and_indexes"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_users_deleted_at"), "users", ["deleted_at"], unique=False)

    op.add_column("cf_accounts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_cf_accounts_deleted_at"), "cf_accounts", ["deleted_at"], unique=False)

    op.add_column("subscriptions", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_subscriptions_deleted_at"), "subscriptions", ["deleted_at"], unique=False)

    op.add_column("operation_logs", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_operation_logs_deleted_at"), "operation_logs", ["deleted_at"], unique=False)
    op.create_index("ix_operation_logs_user_created", "operation_logs", ["user_id", "created_at"], unique=False)

    op.add_column("domain_caches", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_domain_caches_deleted_at"), "domain_caches", ["deleted_at"], unique=False)
    op.drop_constraint("uq_domain_cache_account_domain", "domain_caches", type_="unique")
    op.create_index(
        "ix_domain_caches_account_domain_active",
        "domain_caches",
        ["account_id", "domain"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_domain_caches_account_domain_active", table_name="domain_caches")
    op.create_unique_constraint("uq_domain_cache_account_domain", "domain_caches", ["account_id", "domain"])
    op.drop_index(op.f("ix_domain_caches_deleted_at"), table_name="domain_caches")
    op.drop_column("domain_caches", "deleted_at")

    op.drop_index("ix_operation_logs_user_created", table_name="operation_logs")
    op.drop_index(op.f("ix_operation_logs_deleted_at"), table_name="operation_logs")
    op.drop_column("operation_logs", "deleted_at")

    op.drop_index(op.f("ix_subscriptions_deleted_at"), table_name="subscriptions")
    op.drop_column("subscriptions", "deleted_at")

    op.drop_index(op.f("ix_cf_accounts_deleted_at"), table_name="cf_accounts")
    op.drop_column("cf_accounts", "deleted_at")

    op.drop_index(op.f("ix_users_deleted_at"), table_name="users")
    op.drop_column("users", "deleted_at")
