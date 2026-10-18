import uuid

import pytest
from sqlalchemy import text

from app.core.config import Settings, get_settings
from tests.test_checkout import place, stock_of

URL = "/api/internal/expire-orders"
SECRET = "x" * 40


@pytest.fixture
def cron_on(client):
    base = get_settings()
    client.app.dependency_overrides[get_settings] = lambda: Settings(
        **{**base.model_dump(), "cron_secret": SECRET}, _env_file=None
    )


@pytest.fixture
async def transfer_on(db_engine):
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE business_settings SET transfer_instructions = 'JazzCash 0300'")
        )


async def make_expired_order(client, make_product, db_engine, *, method="TRANSFER", qty=2):
    p = await make_product(stock_quantity=5)
    r = await place(client, [(p["product_id"], qty)], payment_method=method)
    assert r.status_code == 201, r.text
    order = r.json()
    async with db_engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE orders SET payment_deadline_at = now() - interval '1 minute' "
                "WHERE order_id = :o"
            ),
            {"o": uuid.UUID(order["order_id"])},
        )
    return p, order


async def call(client, secret=SECRET):
    headers = {"X-Cron-Secret": secret} if secret else {}
    return await client.post(URL, headers=headers)


# ---- who may call it -----------------------------------------------------------------------


async def test_the_route_does_not_exist_until_a_secret_is_configured(client):
    assert (await call(client)).status_code == 404


async def test_the_secret_is_required_and_checked(client, cron_on):
    assert (await call(client, None)).status_code == 401
    assert (await call(client, "wrong")).status_code == 401
    assert (await call(client, SECRET[:-1])).status_code == 401
    assert (await call(client)).status_code == 200


# ---- what it does --------------------------------------------------------------------------


async def test_it_cancels_expired_orders_returns_stock_and_tells_the_customer_once(
    client, make_product, transfer_on, cron_on, db_engine, emails
):
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = 'shop@example.com'"))
    p, order = await make_expired_order(client, make_product, db_engine)
    assert await stock_of(db_engine, p["product_id"]) == 3
    emails.sent.clear()

    first = await call(client)
    assert first.json() == {"expired": 1, "notified": 1}
    assert await stock_of(db_engine, p["product_id"]) == 5
    customer = emails.to("ayesha@example.com")
    assert len(customer) == 1 and "cancelled" in customer[0].subject
    assert "30 minutes" in customer[0].body
    shop = emails.to("shop@example.com")
    assert len(shop) == 1 and "expired without payment" in shop[0].subject
    async with db_engine.connect() as conn:
        status = (
            await conn.execute(
                text("SELECT status FROM orders WHERE order_id = :o"),
                {"o": uuid.UUID(order["order_id"])},
            )
        ).scalar()
    assert status == "CANCELLED"

    emails.sent.clear()
    second = await call(client)  # nothing new: no second message
    assert second.json() == {"expired": 0, "notified": 0}
    assert emails.sent == []


async def test_orders_the_database_job_already_cancelled_are_still_announced(
    client, make_product, transfer_on, cron_on, db_engine, emails
):
    # pg_cron runs the SQL function every minute; it marks what it cancelled, so the scheduled
    # call can announce it later
    _, order = await make_expired_order(client, make_product, db_engine)
    async with db_engine.begin() as conn:
        assert (await conn.execute(text("SELECT expire_unpaid_online_orders()"))).scalar() == 1
    emails.sent.clear()
    assert (await call(client)).json() == {"expired": 0, "notified": 1}
    assert len(emails.to("ayesha@example.com")) == 1


async def test_a_registered_customer_also_gets_an_in_app_notification(
    client, make_product, transfer_on, cron_on, db_engine, make_token
):
    from tests.conftest import auth

    uid = uuid.uuid4()
    headers = auth(make_token(sub=uid, email="reg@example.com", name="Reg"))
    p = await make_product(stock_quantity=5)
    r = await place(client, [(p["product_id"], 1)], headers=headers, payment_method="TRANSFER")
    assert r.status_code == 201, r.text
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE orders SET payment_deadline_at = now() - interval '1 minute'")
        )
    await call(client)
    notes = (await client.get("/api/customers/me/notifications", headers=headers)).json()["items"]
    assert any(n["title"] == "Order cancelled" for n in notes)


async def test_orders_that_are_not_expired_unpaid_orders_are_left_alone(
    client, admin_h, make_product, transfer_on, cron_on, db_engine, emails
):
    p = await make_product(stock_quantity=9)
    # still inside its window, a COD order, a transfer order whose proof is being checked, and a
    # customer-cancelled order
    inside = (await place(client, [(p["product_id"], 1)], payment_method="TRANSFER")).json()
    cod = (await place(client, [(p["product_id"], 1)])).json()
    checking = (await place(client, [(p["product_id"], 1)], payment_method="TRANSFER")).json()
    await client.post(
        f"/api/orders/{checking['order_id']}/payment-proof", json={"reference": "TX1"}
    )
    mine = (await place(client, [(p["product_id"], 1)], payment_method="TRANSFER")).json()
    await client.post(f"/api/admin/orders/{mine['order_id']}/cancel", headers=admin_h, json={})
    emails.sent.clear()
    assert (await call(client)).json() == {"expired": 0, "notified": 0}
    assert emails.sent == []
    for o in (inside, cod, checking):
        async with db_engine.connect() as conn:
            st = (
                await conn.execute(
                    text("SELECT status FROM orders WHERE order_id = :o"),
                    {"o": uuid.UUID(o["order_id"])},
                )
            ).scalar()
        assert st == "PENDING"
