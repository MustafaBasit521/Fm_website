"""custom order customer offer

Revision ID: ec0f63ac4520
Revises: 433a196d7ae5
Create Date: 2026-10-18 00:55:11.550551
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ec0f63ac4520"
down_revision: str | None = "433a196d7ae5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "custom_orders", sa.Column("customer_offer_paisa", sa.BigInteger(), nullable=True)
    )
    op.create_check_constraint(
        "ck_custom_orders_offer",
        "custom_orders",
        "customer_offer_paisa IS NULL OR customer_offer_paisa >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_custom_orders_offer", "custom_orders", type_="check")
    op.drop_column("custom_orders", "customer_offer_paisa")
