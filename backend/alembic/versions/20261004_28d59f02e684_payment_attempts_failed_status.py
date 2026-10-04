"""payment attempts failed status

Revision ID: 28d59f02e684
Revises: 99f8895b10c0
Create Date: 2026-10-04 21:56:40.734265
"""

from collections.abc import Sequence

from alembic import op

revision: str = "28d59f02e684"
down_revision: str | None = "99f8895b10c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EXPIRE_FUNCTION = """
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
          -- unpaid online order: it has an ONLINE payment and no payment has collected money.
          -- Failed attempts do not protect an order from expiring.
          AND EXISTS (SELECT 1 FROM payments p
                      WHERE p.order_id = o.order_id AND p.method = 'ONLINE')
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

PREVIOUS_EXPIRE_FUNCTION = """
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
          -- unpaid online order: it has an ONLINE payment and nothing beyond PENDING
          AND EXISTS (SELECT 1 FROM payments p
                      WHERE p.order_id = o.order_id AND p.method = 'ONLINE')
          AND NOT EXISTS (SELECT 1 FROM payments p
                          WHERE p.order_id = o.order_id AND p.status <> 'PENDING')
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


def upgrade() -> None:
    # One payments row per attempt: a failed attempt needs its own status (database.md §11).
    # ALTER TYPE ... ADD VALUE must run outside the migration transaction.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'FAILED'")
    op.execute(EXPIRE_FUNCTION)


def downgrade() -> None:
    op.execute(PREVIOUS_EXPIRE_FUNCTION)
    # PostgreSQL cannot drop a value from an enum type; the unused 'FAILED' value is left in
    # place (harmless: no application code of the previous version writes it).
