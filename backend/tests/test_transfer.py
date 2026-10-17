import uuid

import pytest
from sqlalchemy import text

from tests.test_checkout import place, stock_of
from tests.test_orders_customer import set_status

ADMIN = "/api/admin/orders"
INSTRUCTIONS = "JazzCash 0300 1234567 (Sara Ahmed)\nHBL IBAN PK00 0000 0000"
PROOF = f"payment-proofs/{'a' * 32}.png"


@pytest.fixture
async def transfer_on(db_engine):
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE business_settings SET transfer_instructions = :t"), {"t": INSTRUCTIONS}
        )


async def transfer_order(client, make_product, **over):
    p = await make_product(stock_quantity=5)
    r = await place(client, [(p["product_id"], 2)], payment_method="TRANSFER", **over)
    assert r.status_code == 201, r.text
    return p, r.json()


async def deadline(db_engine, order_id):
    async with db_engine.connect() as conn:
        return (
            await conn.execute(
                text("SELECT payment_deadline_at FROM orders WHERE order_id = :o"),
                {"o": uuid.UUID(order_id)},
            )
        ).scalar()


async def run_expiry(db_engine):
    async with db_engine.begin() as conn:
        return (await conn.execute(text("SELECT expire_unpaid_online_orders()"))).scalar()


async def expire(db_engine, order_id):
    async with db_engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE orders SET payment_deadline_at = now() - interval '1 minute' "
                "WHERE order_id = :o"
            ),
            {"o": uuid.UUID(order_id)},
        )
        return (await conn.execute(text("SELECT expire_unpaid_online_orders()"))).scalar()


# ---- offering the method -------------------------------------------------------------------


async def test_transfer_is_offered_only_when_the_shop_wrote_instructions(
    client, make_product, db_engine
):
    p = await make_product(stock_quantity=5)
    items = {"items": [{"product_id": p["product_id"], "quantity": 1}]}
    before = (await client.post("/api/checkout/quote", json=items)).json()["payment_methods"]
    assert "TRANSFER" not in before
    refused = await place(client, [(p["product_id"], 1)], payment_method="TRANSFER")
    assert (
        refused.status_code == 422
        and refused.json()["detail"]["code"] == "PAYMENT_METHOD_UNAVAILABLE"
    )
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE business_settings SET transfer_instructions = :t"), {"t": INSTRUCTIONS}
        )
    after = (await client.post("/api/checkout/quote", json=items)).json()["payment_methods"]
    assert after == ["COD", "TRANSFER"]
    public = (await client.get("/api/settings")).json()
    assert public["transfer_instructions"] == INSTRUCTIONS


async def test_blank_instructions_switch_the_method_off(client, admin_h, make_product):
    p = await make_product(stock_quantity=5)
    await client.patch(
        "/api/admin/settings", headers=admin_h, json={"transfer_instructions": INSTRUCTIONS}
    )
    await client.patch(
        "/api/admin/settings", headers=admin_h, json={"transfer_instructions": "   "}
    )
    items = {"items": [{"product_id": p["product_id"], "quantity": 1}]}
    assert (
        "TRANSFER"
        not in (await client.post("/api/checkout/quote", json=items)).json()["payment_methods"]
    )


# ---- placing and the window ----------------------------------------------------------------


async def test_a_transfer_order_reserves_stock_and_starts_the_30_minute_window(
    client, make_product, transfer_on, db_engine
):
    p, order = await transfer_order(client, make_product)
    assert (order["status"], order["payment_method"], order["payment_status"]) == (
        "PENDING",
        "TRANSFER",
        "PENDING",
    )
    assert order["payment_deadline_at"] is not None and order["proof_submitted_at"] is None
    assert await stock_of(db_engine, p["product_id"]) == 3


async def test_without_proof_the_order_expires_and_returns_the_stock(
    client, make_product, transfer_on, db_engine
):
    p, order = await transfer_order(client, make_product)
    assert await expire(db_engine, order["order_id"]) == 1
    assert await stock_of(db_engine, p["product_id"]) == 5
    gone = (
        await client.get(f"/api/orders/{order['order_id']}")
    ).status_code  # guests have no history
    assert gone in (401, 404)
    late = await client.post(
        f"/api/orders/{order['order_id']}/payment-proof", json={"reference": "TX1"}
    )
    assert late.status_code == 409 and late.json()["detail"]["code"] == "PAYMENT_CLOSED"


# ---- the customer sends proof ---------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"reference": "  "},
        {"image_path": "gallery/x.png"},
        {"image_path": "payment-proofs/../x.png"},
        {"extra": 1},
    ],
)
async def test_proof_needs_a_reference_or_a_valid_screenshot(
    client, make_product, transfer_on, body
):
    _, order = await transfer_order(client, make_product)
    r = await client.post(f"/api/orders/{order['order_id']}/payment-proof", json=body)
    assert r.status_code == 422


async def test_sending_proof_stops_the_clock_and_tells_the_shop(
    client, make_product, transfer_on, db_engine, emails
):
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = 'shop@example.com'"))
    p, order = await transfer_order(client, make_product)
    oid = order["order_id"]
    emails.sent.clear()
    r = await client.post(
        f"/api/orders/{oid}/payment-proof", json={"reference": " TX-998877 ", "image_path": PROOF}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["proof_submitted_at"] is not None
    assert (body["status"], body["payment_status"]) == ("PENDING", "PENDING")  # the shop decides
    assert body["payment_deadline_at"] is None
    assert await deadline(db_engine, oid) is None
    alert = emails.to("shop@example.com")
    assert len(alert) == 1 and "TX-998877" in alert[0].body
    assert len(emails.to("ayesha@example.com")) == 1  # the customer is told it was received
    # while the shop checks there is no deadline, so the order does not expire
    assert await run_expiry(db_engine) == 0
    assert await stock_of(db_engine, p["product_id"]) == 3


async def test_the_proof_route_only_works_for_transfer_orders(client, make_product):
    p = await make_product(stock_quantity=5)
    cod = (await place(client, [(p["product_id"], 1)])).json()
    r = await client.post(f"/api/orders/{cod['order_id']}/payment-proof", json={"reference": "x"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_A_TRANSFER"
    unknown = await client.post(
        f"/api/orders/{uuid.uuid4()}/payment-proof", json={"reference": "x"}
    )
    assert unknown.status_code == 404


async def test_upload_urls_are_given_only_for_open_transfer_orders(
    client, make_product, transfer_on, storage, db_engine
):
    _, order = await transfer_order(client, make_product)
    url = f"/api/orders/{order['order_id']}/payment-proof/upload-url"
    r = await client.post(url, json={"content_type": "image/png"})
    assert r.status_code == 200
    body = r.json()
    assert body["bucket"] == "payment-proofs" and body["storage_path"].startswith("payment-proofs/")
    assert (await client.post(url, json={"content_type": "application/pdf"})).status_code == 422
    await expire(db_engine, order["order_id"])
    assert (await client.post(url, json={"content_type": "image/png"})).status_code == 409


# ---- the admin checks it ------------------------------------------------------------------


async def test_the_admin_marks_the_payment_received_and_the_order_is_confirmed(
    client, admin_h, make_product, transfer_on, emails
):
    _, order = await transfer_order(client, make_product)
    oid = order["order_id"]
    # not before the money is there: the plain status change is refused
    early = await client.post(
        f"{ADMIN}/{oid}/status", headers=admin_h, json={"status": "CONFIRMED"}
    )
    assert early.status_code == 409 and early.json()["detail"]["code"] == "PAYMENT_NOT_VERIFIED"
    await client.post(f"/api/orders/{oid}/payment-proof", json={"reference": "TX1"})
    seen = (await client.get(f"{ADMIN}/{oid}", headers=admin_h)).json()
    assert seen["payments"][0]["proof_reference"] == "TX1"
    emails.sent.clear()
    r = await client.post(f"{ADMIN}/{oid}/confirm-transfer", headers=admin_h)
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["payment_status"]) == ("CONFIRMED", "PAID")
    assert len(emails.to("ayesha@example.com")) >= 1
    again = await client.post(f"{ADMIN}/{oid}/confirm-transfer", headers=admin_h)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "ALREADY_PAID"


async def test_the_admin_can_confirm_without_proof_when_the_money_is_already_there(
    client, admin_h, make_product, transfer_on
):
    _, order = await transfer_order(client, make_product)  # e.g. agreed on WhatsApp
    r = await client.post(f"{ADMIN}/{order['order_id']}/confirm-transfer", headers=admin_h)
    assert r.status_code == 200 and r.json()["payment_status"] == "PAID"


async def test_rejecting_the_proof_gives_the_customer_a_fresh_30_minutes(
    client, admin_h, make_product, transfer_on, db_engine, emails
):
    _, order = await transfer_order(client, make_product)
    oid = order["order_id"]
    none_yet = await client.post(f"{ADMIN}/{oid}/reject-transfer-proof", headers=admin_h)
    assert none_yet.status_code == 409 and none_yet.json()["detail"]["code"] == "NO_PROOF"
    await client.post(f"/api/orders/{oid}/payment-proof", json={"reference": "WRONG"})
    emails.sent.clear()
    r = await client.post(f"{ADMIN}/{oid}/reject-transfer-proof", headers=admin_h)
    assert r.status_code == 200
    assert r.json()["proof_submitted_at"] is None and r.json()["payment_deadline_at"] is not None
    assert any("could not find" in m.subject for m in emails.to("ayesha@example.com"))
    # they can send again
    again = await client.post(f"/api/orders/{oid}/payment-proof", json={"reference": "RIGHT"})
    assert again.status_code == 200
    # and if they do not, the order expires like any other unpaid one
    await client.post(f"{ADMIN}/{oid}/reject-transfer-proof", headers=admin_h)
    assert await expire(db_engine, oid) == 1


async def test_admin_proof_image_link_is_private_and_only_for_admins(
    client, admin_h, customer_h, make_product, transfer_on
):
    _, order = await transfer_order(client, make_product)
    oid = order["order_id"]
    url = f"{ADMIN}/{oid}/payment-proof-image"
    assert (await client.get(url)).status_code == 401
    assert (await client.get(url, headers=customer_h)).status_code == 403
    assert (await client.get(url, headers=admin_h)).json() == {"url": None}
    await client.post(f"/api/orders/{oid}/payment-proof", json={"image_path": PROOF})
    link = (await client.get(url, headers=admin_h)).json()["url"]
    assert link.startswith("https://down.example/payment-proofs/payment-proofs/")


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("POST", f"{ADMIN}/{uuid.uuid4()}/confirm-transfer"),
        ("POST", f"{ADMIN}/{uuid.uuid4()}/reject-transfer-proof"),
        ("GET", f"{ADMIN}/{uuid.uuid4()}/payment-proof-image"),
    ],
)
async def test_transfer_admin_routes_need_the_admin_role(client, customer_h, method, url):
    assert (await client.request(method, url)).status_code == 401
    assert (await client.request(method, url, headers=customer_h)).status_code == 403


# ---- cancelling and refunding a paid transfer ---------------------------------------------


async def test_a_cancelled_paid_transfer_is_refunded_by_recording_it(
    client, admin_h, make_product, transfer_on, db_engine
):
    p, order = await transfer_order(client, make_product)
    oid = order["order_id"]
    await client.post(f"{ADMIN}/{oid}/confirm-transfer", headers=admin_h)
    cancelled = await client.post(f"{ADMIN}/{oid}/cancel", headers=admin_h, json={})
    assert cancelled.status_code == 200 and cancelled.json()["refund_due_paisa"] > 0
    due = cancelled.json()["refund_due_paisa"]
    assert await stock_of(db_engine, p["product_id"]) == 5
    half = await client.post(f"{ADMIN}/{oid}/refund", headers=admin_h, json={"amount_paisa": 100})
    assert half.status_code == 200 and half.json()["payment_status"] == "PARTIALLY_REFUNDED"
    rest = await client.post(f"{ADMIN}/{oid}/refund", headers=admin_h, json={})
    assert rest.status_code == 200 and rest.json()["payment_status"] == "REFUNDED"
    assert rest.json()["refund_due_paisa"] == 0
    too_much = await client.post(f"{ADMIN}/{oid}/refund", headers=admin_h, json={})
    assert too_much.status_code == 409 and due > 100


async def test_an_unpaid_transfer_order_can_be_cancelled_without_a_charge(
    client, admin_h, make_product, transfer_on, db_engine
):
    p, order = await transfer_order(client, make_product)
    oid = order["order_id"]
    await set_status(db_engine, oid, "PROCESSING")
    r = await client.post(f"{ADMIN}/{oid}/cancel", headers=admin_h, json={})
    assert r.status_code == 200 and r.json()["cancellation_charge_paisa"] == 0
