"""release order stock function

Revision ID: 99f8895b10c0
Revises: 95574c08ea49
Create Date: 2026-10-04 19:09:57.669422
"""

from collections.abc import Sequence

from alembic import op

revision: str = "99f8895b10c0"
down_revision: str | None = "95574c08ea49"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RELEASE_FUNCTION = """
CREATE OR REPLACE FUNCTION release_order_stock(p_order_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    -- Lock the affected product rows in id order: the same order checkout uses, so a
    -- cancellation and a checkout touching the same products cannot deadlock.
    PERFORM 1
    FROM products
    WHERE product_id IN (SELECT product_id FROM order_items
                         WHERE order_id = p_order_id AND product_id IS NOT NULL)
    ORDER BY product_id
    FOR UPDATE;

    -- Ready-to-ship stock goes back. Made-to-order capacity is derived from active orders,
    -- so a cancelled order stops consuming it without any change here.
    UPDATE products pr
    SET stock_quantity = pr.stock_quantity + r.qty, updated_at = now()
    FROM (SELECT oi.product_id, sum(oi.quantity)::integer AS qty
          FROM order_items oi
          WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
          GROUP BY oi.product_id) r
    WHERE pr.product_id = r.product_id AND pr.availability_type = 'READY_TO_SHIP';
END
$$;
"""

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

PREVIOUS_EXPIRE_FUNCTION = """
CREATE OR REPLACE FUNCTION expire_unpaid_online_orders() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    expired integer;
BEGIN
    -- Serialize runs (pg_cron + the API's pre-checkout call) so they cannot deadlock on
    -- product rows.
    PERFORM pg_advisory_xact_lock(hashtext('expire_unpaid_online_orders'));

    WITH due AS (
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
        FOR UPDATE OF o SKIP LOCKED
    ), cancelled AS (
        UPDATE orders o
        SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
        FROM due
        WHERE o.order_id = due.order_id
        RETURNING o.order_id
    ), release AS (
        -- Ready-to-ship stock goes back. Made-to-order capacity is derived from active
        -- orders, so cancelling the order releases it automatically.
        SELECT oi.product_id, sum(oi.quantity)::integer AS qty
        FROM order_items oi
        JOIN cancelled c ON c.order_id = oi.order_id
        JOIN products pr ON pr.product_id = oi.product_id
        WHERE pr.availability_type = 'READY_TO_SHIP'
        GROUP BY oi.product_id
    ), restocked AS (
        UPDATE products pr
        SET stock_quantity = pr.stock_quantity + r.qty, updated_at = now()
        FROM release r
        WHERE pr.product_id = r.product_id
        RETURNING pr.product_id
    )
    SELECT count(*) INTO expired FROM cancelled;

    RETURN expired;
END
$$;
"""


def upgrade() -> None:
    op.execute(RELEASE_FUNCTION)
    op.execute(EXPIRE_FUNCTION)


def downgrade() -> None:
    op.execute(PREVIOUS_EXPIRE_FUNCTION)
    op.execute("DROP FUNCTION IF EXISTS release_order_stock(uuid)")
