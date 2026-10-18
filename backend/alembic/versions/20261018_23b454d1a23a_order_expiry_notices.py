"""order expiry notices

Revision ID: 23b454d1a23a
Revises: b061159f49d0
Create Date: 2026-10-18 19:07:41.837297
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "23b454d1a23a"
down_revision: str | None = "b061159f49d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


FUNCTION = """
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

PREVIOUS = FUNCTION.replace(", expired_at = now()", "")


def upgrade() -> None:
    op.add_column("orders", sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "orders", sa.Column("expiry_notified_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Orders that expired before this migration are not announced late: mark them as done.
    op.execute(
        "UPDATE orders SET expired_at = cancelled_at, expiry_notified_at = now() "
        "WHERE status = 'CANCELLED' AND payment_deadline_at IS NOT NULL "
        "AND cancelled_at >= payment_deadline_at "
        "AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.order_id "
        "AND p.method IN ('ONLINE', 'TRANSFER'))"
    )
    op.execute(FUNCTION)


def downgrade() -> None:
    op.execute(PREVIOUS)
    op.drop_column("orders", "expiry_notified_at")
    op.drop_column("orders", "expired_at")
