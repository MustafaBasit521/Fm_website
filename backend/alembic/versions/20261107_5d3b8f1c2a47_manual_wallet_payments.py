"""manual wallet payments (Easypaisa / JazzCash with QR codes and payment attempts)

Revision ID: 5d3b8f1c2a47
Revises: 23b454d1a23a
Create Date: 2026-11-07 15:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "5d3b8f1c2a47"
down_revision: str | None = "23b454d1a23a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


EXPIRE = """
CREATE OR REPLACE FUNCTION expire_unpaid_online_orders() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    expired integer := 0;
    due_id uuid;
BEGIN
    -- Serialize runs (pg_cron + the API's pre-checkout call).
    PERFORM pg_advisory_xact_lock(hashtext('expire_unpaid_online_orders'));

    FOR due_id IN
        SELECT o.order_id
        FROM orders o
        WHERE o.status = 'PENDING'
          AND o.payment_deadline_at IS NOT NULL
          AND o.payment_deadline_at <= now()
          -- unpaid order with a payment window: an online or manual (wallet) payment and no
          -- payment has collected money. (A manual payment whose receipt was sent has no deadline
          -- any more: the shop is checking it.) Failed attempts do not protect an order.
          AND EXISTS (SELECT 1 FROM payments p
                      WHERE p.order_id = o.order_id
                        AND p.method IN ('ONLINE', 'TRANSFER', 'EASYPAISA', 'JAZZCASH'))
          AND NOT EXISTS (SELECT 1 FROM payments p
                          WHERE p.order_id = o.order_id
                            AND p.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'))
        ORDER BY o.order_id
        FOR UPDATE OF o SKIP LOCKED
    LOOP
        UPDATE orders
        SET status = 'CANCELLED', cancelled_at = now(), expired_at = now(), updated_at = now()
        WHERE order_id = due_id;
        PERFORM release_order_stock(due_id);
        expired := expired + 1;
    END LOOP;

    RETURN expired;
END
$$;
"""

PREVIOUS = EXPIRE.replace(
    "p.method IN ('ONLINE', 'TRANSFER', 'EASYPAISA', 'JAZZCASH')",
    "p.method IN ('ONLINE', 'TRANSFER')",
)


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE must run outside the migration transaction.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'EASYPAISA'")
        op.execute("ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'JAZZCASH'")

    attempt_status = postgresql.ENUM(
        "SUBMITTED", "PAID", "REJECTED", name="payment_attempt_status", create_type=False
    )
    reason = postgresql.ENUM(
        "INCORRECT_REFERENCE",
        "AMOUNT_MISMATCH",
        "NOT_RECEIVED",
        "UNCLEAR_RECEIPT",
        "DUPLICATE_REFERENCE",
        "OTHER",
        name="payment_rejection_reason",
        create_type=False,
    )
    attempt_status.create(op.get_bind(), checkfirst=True)
    reason.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "payment_attempts",
        sa.Column("attempt_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "payment_id",
            sa.Uuid(),
            sa.ForeignKey("payments.payment_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "order_id",
            sa.Uuid(),
            sa.ForeignKey("orders.order_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("amount_paisa", sa.BigInteger(), nullable=False),
        sa.Column("transaction_reference", sa.Text(), nullable=False),
        sa.Column("receipt_path", sa.Text(), nullable=False),
        sa.Column("status", attempt_status, nullable=False, server_default="SUBMITTED"),
        sa.Column("rejection_reason", reason, nullable=True),
        sa.Column("rejection_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("amount_paisa >= 0", name="ck_payment_attempts_amount_nonneg"),
        sa.CheckConstraint(
            "(status = 'SUBMITTED' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR "
            "(status IN ('PAID', 'REJECTED') AND reviewed_by IS NOT NULL "
            "AND reviewed_at IS NOT NULL)",
            name="ck_payment_attempts_review",
        ),
        sa.CheckConstraint(
            "(status = 'REJECTED') = (rejection_reason IS NOT NULL)",
            name="ck_payment_attempts_reason",
        ),
        sa.CheckConstraint(
            "rejection_reason IS DISTINCT FROM 'OTHER' "
            "OR coalesce(length(btrim(rejection_note)), 0) > 0",
            name="ck_payment_attempts_other_note",
        ),
        sa.CheckConstraint(
            "length(btrim(transaction_reference)) > 0", name="ck_payment_attempts_reference"
        ),
    )
    op.create_index("ix_payment_attempts_order_id", "payment_attempts", ["order_id"])
    op.create_index(
        "ix_payment_attempts_status_created", "payment_attempts", ["status", "created_at"]
    )
    op.create_index(
        "uq_payment_attempts_open",
        "payment_attempts",
        ["payment_id"],
        unique=True,
        postgresql_where=sa.text("status = 'SUBMITTED'"),
    )
    op.create_index(
        "uq_payment_attempts_reference",
        "payment_attempts",
        [sa.text("lower(transaction_reference)")],
        unique=True,
        postgresql_where=sa.text("status <> 'REJECTED'"),
    )
    op.create_index(
        "uq_payment_attempts_receipt", "payment_attempts", ["receipt_path"], unique=True
    )

    # Details sent through the old single "transfer" method become undecided attempts, but only
    # where both a number and a screenshot exist (a submission now needs both).
    op.execute(
        """
        INSERT INTO payment_attempts
            (attempt_id, payment_id, order_id, amount_paisa, transaction_reference, receipt_path,
             created_at)
        SELECT gen_random_uuid(), p.payment_id, p.order_id, p.amount_paisa, p.proof_reference,
               p.proof_image_path, p.proof_submitted_at
        FROM payments p
        WHERE p.proof_submitted_at IS NOT NULL
          AND btrim(coalesce(p.proof_reference, '')) <> ''
          AND p.proof_image_path IS NOT NULL
          AND p.status = 'PENDING'
        ON CONFLICT DO NOTHING
        """
    )
    op.drop_column("payments", "proof_submitted_at")
    op.drop_column("payments", "proof_image_path")
    op.drop_column("payments", "proof_reference")

    op.add_column("business_settings", sa.Column("easypaisa_qr_path", sa.Text(), nullable=True))
    op.add_column("business_settings", sa.Column("easypaisa_details", sa.Text(), nullable=True))
    op.add_column("business_settings", sa.Column("jazzcash_qr_path", sa.Text(), nullable=True))
    op.add_column("business_settings", sa.Column("jazzcash_details", sa.Text(), nullable=True))
    op.drop_column("business_settings", "transfer_instructions")

    op.execute(EXPIRE)


def downgrade() -> None:
    op.execute(PREVIOUS)
    op.add_column("business_settings", sa.Column("transfer_instructions", sa.Text(), nullable=True))
    for column in (
        "jazzcash_details",
        "jazzcash_qr_path",
        "easypaisa_details",
        "easypaisa_qr_path",
    ):
        op.drop_column("business_settings", column)
    op.add_column("payments", sa.Column("proof_reference", sa.Text(), nullable=True))
    op.add_column("payments", sa.Column("proof_image_path", sa.Text(), nullable=True))
    op.add_column(
        "payments", sa.Column("proof_submitted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.execute(
        """
        UPDATE payments p
        SET proof_reference = a.transaction_reference, proof_image_path = a.receipt_path,
            proof_submitted_at = a.created_at
        FROM payment_attempts a
        WHERE a.payment_id = p.payment_id AND a.status = 'SUBMITTED'
        """
    )
    op.drop_table("payment_attempts")
    op.execute("DROP TYPE payment_rejection_reason")
    op.execute("DROP TYPE payment_attempt_status")
    # PostgreSQL cannot drop a value from an enum type; 'EASYPAISA' and 'JAZZCASH' stay.
