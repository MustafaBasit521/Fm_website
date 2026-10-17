"""payment by transfer

Revision ID: b061159f49d0
Revises: ec0f63ac4520
Create Date: 2026-10-18 01:53:17.594968
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b061159f49d0"
down_revision: str | None = "ec0f63ac4520"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


EXPIRE_WITH_TRANSFER = """
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
          -- unpaid order with a payment window: an ONLINE or TRANSFER payment and no payment
          -- has collected money. (A transfer whose proof was sent has no deadline any more: the
          -- shop is checking it.) Failed attempts do not protect an order from expiring.
          AND EXISTS (SELECT 1 FROM payments p
                      WHERE p.order_id = o.order_id AND p.method IN ('ONLINE', 'TRANSFER'))
          AND NOT EXISTS (SELECT 1 FROM payments p
                          WHERE p.order_id = o.order_id
                            AND p.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'))
        ORDER BY o.order_id
        FOR UPDATE OF o SKIP LOCKED
    LOOP
        UPDATE orders SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
        WHERE order_id = due_id;
        PERFORM release_order_stock(due_id);
        expired := expired + 1;
    END LOOP;

    RETURN expired;
END
$$;
"""

ONLINE_ONLY_EXPIRE = EXPIRE_WITH_TRANSFER.replace(
    "p.method IN ('ONLINE', 'TRANSFER')", "p.method = 'ONLINE'"
)


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE must run outside the migration transaction.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'TRANSFER'")
    op.add_column("payments", sa.Column("proof_reference", sa.Text(), nullable=True))
    op.add_column("payments", sa.Column("proof_image_path", sa.Text(), nullable=True))
    op.add_column(
        "payments", sa.Column("proof_submitted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("business_settings", sa.Column("transfer_instructions", sa.Text(), nullable=True))
    op.execute(EXPIRE_WITH_TRANSFER)


def downgrade() -> None:
    op.execute(ONLINE_ONLY_EXPIRE)
    op.drop_column("business_settings", "transfer_instructions")
    op.drop_column("payments", "proof_submitted_at")
    op.drop_column("payments", "proof_image_path")
    op.drop_column("payments", "proof_reference")
    # PostgreSQL cannot drop a value from an enum type; the unused 'TRANSFER' value stays.
