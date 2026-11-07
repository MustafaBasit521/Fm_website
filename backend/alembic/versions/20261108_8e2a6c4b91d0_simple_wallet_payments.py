"""simple wallet payments: "mark as paid" details on payments, and a refund history

Revision ID: 8e2a6c4b91d0
Revises: 5d3b8f1c2a47
Create Date: 2026-11-08 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8e2a6c4b91d0"
down_revision: str | None = "5d3b8f1c2a47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Who marked a wallet payment as paid, when, and the optional wallet transaction number/note.
    op.add_column("payments", sa.Column("paid_marked_by", sa.Uuid(), nullable=True))
    op.add_column(
        "payments", sa.Column("paid_marked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("payments", sa.Column("paid_reference", sa.Text(), nullable=True))
    op.add_column("payments", sa.Column("paid_note", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_payments_marked_paid",
        "payments",
        "(paid_marked_by IS NULL) = (paid_marked_at IS NULL)",
    )

    op.create_table(
        "payment_refunds",
        sa.Column("refund_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "payment_id",
            sa.Uuid(),
            sa.ForeignKey("payments.payment_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("amount_paisa", sa.BigInteger(), nullable=False),
        sa.Column("wallet_reference", sa.Text(), nullable=True),
        sa.Column("recorded_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("amount_paisa > 0", name="ck_payment_refunds_amount_positive"),
    )
    op.create_index("ix_payment_refunds_payment_id", "payment_refunds", ["payment_id"])


def downgrade() -> None:
    op.drop_table("payment_refunds")
    op.drop_constraint("ck_payments_marked_paid", "payments", type_="check")
    for column in ("paid_note", "paid_reference", "paid_marked_at", "paid_marked_by"):
        op.drop_column("payments", column)
