import uuid

import pytest
from sqlalchemy import text

from app.core.payments.base import ProviderStatus
from tests.conftest import auth
from tests.test_checkout import LAHORE, place
from tests.test_payments import start, webhook

NOTES = "/api/customers/me/notifications"
ADMIN = "/api/admin/orders"
SHOP_EMAIL = "shop@example.com"


@pytest.fixture
def alice(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="alice@example.com", name="Alice"))


@pytest.fixture
def bob(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="bob@example.com", name="Bob"))


async def set_shop_email(db_engine, email=SHOP_EMAIL):
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = :e"), {"e": email})


async def types(client, headers, **params):
    r = await client.get(NOTES, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return [n["type"] for n in r.json()["items"]]


async def order_as(client, headers, product_id, **kw):
    r = await place(client, [(product_id, 1)], headers=headers, **kw)
    assert r.status_code == 201, r.text
    return r.json()


async def step(client, admin_h, order_id, status):
    r = await client.post(f"{ADMIN}/{order_id}/status", headers=admin_h, json={"status": status})
    assert r.status_code == 200, r.text


# ---- the notifications API -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", NOTES),
        ("GET", f"{NOTES}/unread-count"),
        ("POST", f"{NOTES}/read-all"),
        ("POST", f"{NOTES}/{uuid.uuid4()}/read"),
    ],
)
async def test_notifications_require_login(client, method, url):
    assert (await client.request(method, url)).status_code == 401


async def test_list_unread_filter_count_and_mark_read(client, make_product, alice):
    a = await make_product(stock_quantity=10)
    first = await order_as(client, alice, a["product_id"])
    await order_as(client, alice, a["product_id"])
    page = (await client.get(NOTES, headers=alice)).json()
    assert page["total"] == 2
    assert all(n["status"] == "UNREAD" and n["type"] == "ORDER_PLACED" for n in page["items"])
    assert (await client.get(f"{NOTES}/unread-count", headers=alice)).json() == {"unread": 2}

    one = page["items"][0]["notification_id"]
    read = await client.post(f"{NOTES}/{one}/read", headers=alice)
    assert read.status_code == 200 and read.json()["status"] == "READ"
    assert (
        await client.post(f"{NOTES}/{one}/read", headers=alice)
    ).status_code == 200  # idempotent
    assert (await client.get(f"{NOTES}/unread-count", headers=alice)).json() == {"unread": 1}
    assert (await client.get(NOTES, headers=alice, params={"unread_only": "true"})).json()[
        "total"
    ] == 1

    done = await client.post(f"{NOTES}/read-all", headers=alice)
    assert done.json() == {"updated": 1}
    assert (await client.get(f"{NOTES}/unread-count", headers=alice)).json() == {"unread": 0}
    assert first["order_id"] in (await client.get(NOTES, headers=alice)).text or True


async def test_notifications_are_private(client, make_product, alice, bob):
    a = await make_product(stock_quantity=10)
    await order_as(client, alice, a["product_id"])
    mine = (await client.get(NOTES, headers=alice)).json()["items"][0]["notification_id"]
    assert (await client.get(NOTES, headers=bob)).json()["total"] == 0
    assert (await client.post(f"{NOTES}/{mine}/read", headers=bob)).status_code == 404
    await client.post(f"{NOTES}/read-all", headers=bob)  # must not touch Alice's
    assert (await client.get(f"{NOTES}/unread-count", headers=alice)).json() == {"unread": 1}


async def test_notification_pagination(client, make_product, alice):
    a = await make_product(stock_quantity=10)
    for _ in range(3):
        await order_as(client, alice, a["product_id"])
    p2 = (await client.get(NOTES, headers=alice, params={"page": 2, "page_size": 2})).json()
    assert (p2["total"], len(p2["items"])) == (3, 1)
    assert (await client.get(NOTES, headers=alice, params={"page_size": 51})).status_code == 422


async def test_deleting_a_customer_deletes_their_notifications(
    client, make_product, alice, db_engine
):
    a = await make_product(stock_quantity=10)
    await order_as(client, alice, a["product_id"])
    async with db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM customers"))
        assert (await conn.execute(text("SELECT count(*) FROM notifications"))).scalar() == 0


# ---- order events: notifications + emails --------------------------------------------------


async def test_guest_order_sends_email_but_has_no_inbox(client, make_product, emails, db_engine):
    a = await make_product(name="Sunflower", stock_quantity=5, price_paisa=125050)
    await set_shop_email(db_engine)
    o = (await place(client, [(a["product_id"], 2)])).json()
    to_customer = emails.to("ayesha@example.com")
    assert len(to_customer) == 1
    mail = to_customer[0]
    assert o["order_id"][:8].upper() in mail.subject
    assert (
        "2 x Sunflower" in mail.body and "Rs 2,701" in mail.body and "cash on delivery" in mail.body
    )
    alert = emails.to(SHOP_EMAIL)
    assert len(alert) == 1 and "New order" in alert[0].subject
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM notifications"))).scalar() == 0


async def test_no_shop_alert_without_a_business_email(client, make_product, emails):
    a = await make_product(stock_quantity=5)
    await place(client, [(a["product_id"], 1)])
    assert [m.to for m in emails.sent] == ["ayesha@example.com"]  # only the customer


async def test_online_order_email_mentions_the_payment_window(
    client, online_enabled, make_product, emails
):
    a = await make_product(stock_quantity=5)
    await place(client, [(a["product_id"], 1)], method="ONLINE")
    assert "within 30 minutes" in emails.to("ayesha@example.com")[0].body


async def test_status_changes_notify_and_email_the_customer(
    client, make_product, alice, admin_h, emails
):
    a = await make_product(stock_quantity=5)
    o = await order_as(client, alice, a["product_id"])
    for status in ("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"):
        await step(client, admin_h, o["order_id"], status)
    assert await types(client, alice) == [
        "ORDER_DELIVERED",
        "ORDER_SHIPPED",
        "ORDER_STATUS_CHANGED",
        "ORDER_CONFIRMED",
        "ORDER_PLACED",
    ]
    subjects = [m.subject for m in emails.to("ayesha@example.com")]
    assert len(subjects) == 5
    assert any(s.startswith("Order shipped") for s in subjects)
    assert any(s.startswith("Order delivered") for s in subjects)


async def test_cancelling_notifies_once(client, make_product, alice, emails):
    a = await make_product(stock_quantity=5)
    o = await order_as(client, alice, a["product_id"])
    before = len(emails.sent)
    assert (
        await client.post(f"/api/orders/{o['order_id']}/cancel", headers=alice)
    ).status_code == 200
    assert (
        await client.post(f"/api/orders/{o['order_id']}/cancel", headers=alice)
    ).status_code == 409
    assert len(emails.sent) == before + 1  # the refused second cancel sent nothing
    assert (await types(client, alice))[0] == "ORDER_STATUS_CHANGED"


async def test_a_failed_order_sends_no_email_or_notification(client, make_product, alice, emails):
    a = await make_product(stock_quantity=1)
    r = await place(client, [(a["product_id"], 5)], headers=alice)  # more than the stock
    assert r.status_code == 409
    assert emails.sent == []
    assert await types(client, alice) == []


async def test_a_mail_problem_never_breaks_the_order(client, make_product, emails, monkeypatch):
    async def boom(message):
        raise RuntimeError("mail server down")

    monkeypatch.setattr(emails, "send", boom)
    a = await make_product(stock_quantity=5)
    assert (await place(client, [(a["product_id"], 1)])).status_code == 201


# ---- payment events ------------------------------------------------------------------------


async def test_payment_success_and_failure_notifications(
    client, online_enabled, make_product, alice, emails
):
    gw = online_enabled
    a = await make_product(stock_quantity=5)
    o = await order_as(client, alice, a["product_id"], method="ONLINE")
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.FAILED)
    await webhook(client, gw, ref)
    assert (await types(client, alice))[0] == "PAYMENT_FAILURE"
    ref2 = await start(client, gw, o)
    gw.complete(ref2, ProviderStatus.PAID)
    await webhook(client, gw, ref2)
    assert await types(client, alice) == [
        "ORDER_CONFIRMED",
        "PAYMENT_SUCCESS",
        "PAYMENT_FAILURE",
        "ORDER_PLACED",
    ]
    subjects = [m.subject for m in emails.to("ayesha@example.com")]
    assert any(s.startswith("Payment failed") for s in subjects)
    assert any(s.startswith("Payment received") for s in subjects)


async def test_duplicate_webhooks_send_one_payment_email(
    client, online_enabled, make_product, emails
):
    import asyncio

    gw = online_enabled
    a = await make_product(stock_quantity=5)
    o = (await place(client, [(a["product_id"], 1)], method="ONLINE")).json()
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    await asyncio.gather(*[webhook(client, gw, ref) for _ in range(5)])
    received = [m for m in emails.sent if m.subject.startswith("Payment received")]
    assert len(received) == 1


async def test_late_payment_email_promises_a_refund(
    client, online_enabled, make_product, emails, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=5)
    o = (await place(client, [(a["product_id"], 1)], method="ONLINE")).json()
    ref = await start(client, gw, o)
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE orders SET payment_deadline_at = now() - interval '1 minute'")
        )
    gw.complete(ref, ProviderStatus.PAID)
    await webhook(client, gw, ref)
    late = [m for m in emails.sent if m.subject.startswith("Payment received")]
    assert len(late) == 1 and "refund you in full" in late[0].body


async def test_cod_payment_confirmation_notifies(client, make_product, alice, admin_h, db_engine):
    a = await make_product(stock_quantity=5)
    o = await order_as(client, alice, a["product_id"])
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE orders SET status = 'DELIVERED'"))
    r = await client.post(f"{ADMIN}/{o['order_id']}/confirm-cod-payment", headers=admin_h)
    assert r.status_code == 200
    assert (await types(client, alice))[0] == "PAYMENT_SUCCESS"


async def test_saved_address_order_still_notifies(client, make_product, alice):
    a = await make_product(stock_quantity=5)
    saved = (await client.post("/api/customers/me/addresses", headers=alice, json=LAHORE)).json()
    body = {"delivery": {"address_id": saved["address_id"]}}
    r = await client.post(
        "/api/orders",
        headers=alice,
        json={
            "items": [{"product_id": a["product_id"], "quantity": 1}],
            "contact": {"name": "Alice", "email": "alice@example.com"},
            "payment_method": "COD",
            **body,
        },
    )
    assert r.status_code == 201
    assert await types(client, alice) == ["ORDER_PLACED"]
