"""The SQL function expire_unpaid_online_orders() (business-rules §13)."""

import uuid

from sqlalchemy import text

from tests.test_checkout import place, stock_of


async def run_expiry(db_engine) -> int:
    async with db_engine.begin() as conn:
        return (await conn.execute(text("SELECT expire_unpaid_online_orders()"))).scalar()


async def make_overdue(db_engine, order_id: str, minutes_ago: int = 5):
    async with db_engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE orders SET payment_deadline_at = now() - make_interval(mins => :m)"
                " WHERE order_id = :o"
            ),
            {"m": minutes_ago, "o": uuid.UUID(order_id)},
        )


async def order_row(db_engine, order_id: str):
    async with db_engine.connect() as conn:
        return (
            await conn.execute(
                text("SELECT status, cancelled_at IS NOT NULL FROM orders WHERE order_id = :o"),
                {"o": uuid.UUID(order_id)},
            )
        ).one()


async def test_expired_unpaid_online_order_is_cancelled_and_stock_returned(
    client, online_enabled, make_product, db_engine
):
    a = await make_product(stock_quantity=5)
    o = (await place(client, [(a["product_id"], 2)], method="ONLINE")).json()
    assert await stock_of(db_engine, a["product_id"]) == 3
    await make_overdue(db_engine, o["order_id"])

    assert await run_expiry(db_engine) == 1
    assert tuple(await order_row(db_engine, o["order_id"])) == ("CANCELLED", True)
    assert await stock_of(db_engine, a["product_id"]) == 5  # returned
    # idempotent: a second run does nothing and never double-restocks
    assert await run_expiry(db_engine) == 0
    assert await stock_of(db_engine, a["product_id"]) == 5


async def test_orders_inside_their_window_are_left_alone(
    client, online_enabled, make_product, db_engine
):
    a = await make_product(stock_quantity=5)
    o = (await place(client, [(a["product_id"], 1)], method="ONLINE")).json()
    assert await run_expiry(db_engine) == 0
    assert (await order_row(db_engine, o["order_id"]))[0] == "PENDING"
    assert await stock_of(db_engine, a["product_id"]) == 4


async def test_cod_orders_never_expire(client, make_product, db_engine):
    a = await make_product(stock_quantity=5)
    o = (await place(client, [(a["product_id"], 1)])).json()  # COD: no deadline
    assert await run_expiry(db_engine) == 0
    # even if someone wrongly gave a COD order a past deadline
    await make_overdue(db_engine, o["order_id"])
    assert await run_expiry(db_engine) == 0
    assert (await order_row(db_engine, o["order_id"]))[0] == "PENDING"


async def test_paid_or_confirmed_orders_are_never_cancelled(
    client, online_enabled, make_product, db_engine
):
    a = await make_product(stock_quantity=5)
    paid = (await place(client, [(a["product_id"], 1)], method="ONLINE")).json()
    confirmed = (await place(client, [(a["product_id"], 1)], method="ONLINE")).json()
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE payments SET status = 'PAID' WHERE order_id = :o"),
            {"o": uuid.UUID(paid["order_id"])},
        )
        await conn.execute(
            text("UPDATE orders SET status = 'CONFIRMED' WHERE order_id = :o"),
            {"o": uuid.UUID(confirmed["order_id"])},
        )
    await make_overdue(db_engine, paid["order_id"])
    await make_overdue(db_engine, confirmed["order_id"])
    assert await run_expiry(db_engine) == 0
    assert (await order_row(db_engine, paid["order_id"]))[0] == "PENDING"
    assert (await order_row(db_engine, confirmed["order_id"]))[0] == "CONFIRMED"
    assert await stock_of(db_engine, a["product_id"]) == 3


async def test_expiring_frees_made_to_order_capacity_without_touching_stock(
    client, online_enabled, make_product, db_engine
):
    m = await make_product(availability_type="MADE_TO_ORDER", stock_quantity=0, max_active_units=1)
    pid = m["product_id"]
    o = (await place(client, [(pid, 1)], method="ONLINE")).json()
    assert (await place(client, [(pid, 1)], method="ONLINE")).status_code == 409  # capacity held
    await make_overdue(db_engine, o["order_id"])
    assert await run_expiry(db_engine) == 1
    assert await stock_of(db_engine, pid) == 0  # made-to-order stock is never adjusted
    assert (await place(client, [(pid, 1)], method="ONLINE")).status_code == 201  # freed


async def test_placing_an_order_first_clears_expired_reservations(
    client, online_enabled, make_product, db_engine
):
    a = await make_product(stock_quantity=1)
    pid = a["product_id"]
    stale = (await place(client, [(pid, 1)], method="ONLINE")).json()
    assert (await place(client, [(pid, 1)])).status_code == 409  # the last unit is held
    await make_overdue(db_engine, stale["order_id"])
    # no cron needed for correctness: checkout runs the same function before reserving
    assert (await place(client, [(pid, 1)])).status_code == 201
    assert (await order_row(db_engine, stale["order_id"]))[0] == "CANCELLED"


async def test_expiry_copes_with_deleted_products(
    client, online_enabled, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=2)
    o = (await place(client, [(a["product_id"], 1)], method="ONLINE")).json()
    await client.delete(f"/api/admin/products/{a['product_id']}", headers=admin_h)
    await make_overdue(db_engine, o["order_id"])
    assert await run_expiry(db_engine) == 1  # nothing to restock, but no error
    assert (await order_row(db_engine, o["order_id"]))[0] == "CANCELLED"


async def test_expires_many_orders_across_products_in_one_run(
    client, online_enabled, make_product, db_engine
):
    a, b = (
        await make_product(name="A", stock_quantity=4),
        await make_product(name="B", stock_quantity=4),
    )
    ids = []
    for _ in range(2):
        o = (
            await place(client, [(a["product_id"], 1), (b["product_id"], 2)], method="ONLINE")
        ).json()
        ids.append(o["order_id"])
    for order_id in ids:  # make them overdue only after both exist (placing an order also expires)
        await make_overdue(db_engine, order_id)
    assert await run_expiry(db_engine) == 2
    assert await stock_of(db_engine, a["product_id"]) == 4
    assert await stock_of(db_engine, b["product_id"]) == 4
