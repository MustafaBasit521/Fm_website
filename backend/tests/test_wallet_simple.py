"""Easypaisa / JazzCash at launch (MANUAL_RECEIPTS_ENABLED off, business-rules §13): the customer
pays and sends the screenshot on WhatsApp, and the admin presses "Mark as paid" after seeing the
money in the shop's own wallet app. There is no receipt upload, no deadline and no expiry.

The receipt flow that is switched off here is tested in test_wallet_payments.py (flag on)."""

import asyncio
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth
from tests.test_checkout import place, stock_of

ORDERS = "/api/admin/orders"


@pytest.fixture
async def wallets(db_engine):
    """The shop shows an Easypaisa number and a JazzCash QR code and has a WhatsApp number."""
    async with db_engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE business_settings SET easypaisa_details = '0300 1234567 (Ayesha)', "
                "jazzcash_qr_path = :q, whatsapp = '+923001234567', email = 'shop@example.com'"
            ),
            {"q": f"payment-qr/{'2' * 32}.png"},
        )


async def wallet_order(client, make_product, method="EASYPAISA", headers=None):
    p = await make_product(stock_quantity=5)
    r = await place(client, [(p["product_id"], 2)], payment_method=method, headers=headers)
    assert r.status_code == 201, r.text
    return p, r.json()


def mark(client, admin_h, order, amount=None, **extra):
    return client.post(
        f"{ORDERS}/{order['order_id']}/mark-paid",
        headers=admin_h,
        json={"amount_paisa": amount or order["total_amount_paisa"], **extra},
    )


async def payment_row(db_engine, order_id):
    async with db_engine.connect() as conn:
        return (
            (
                await conn.execute(
                    text("SELECT * FROM payments WHERE order_id = :o"), {"o": uuid.UUID(order_id)}
                )
            )
            .mappings()
            .one()
        )


# ---- offering the wallets --------------------------------------------------------------------


async def test_a_wallet_needs_its_payment_details_and_a_whatsapp_number(
    client, make_product, db_engine
):
    p = await make_product(stock_quantity=5)
    items = {"items": [{"product_id": p["product_id"], "quantity": 1}]}

    async def methods():
        return (await client.post("/api/checkout/quote", json=items)).json()["payment_methods"]

    assert await methods() == ["COD"]
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET easypaisa_details = '0300 1234567'"))
    assert await methods() == ["COD"]  # no WhatsApp number: nowhere to send the screenshot
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET whatsapp = '+923001234567'"))
    assert await methods() == ["COD", "EASYPAISA"]
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE business_settings SET jazzcash_qr_path = :q"),
            {"q": f"payment-qr/{'2' * 32}.png"},
        )
    assert await methods() == ["COD", "EASYPAISA", "JAZZCASH"]
    refused = await place(client, [(p["product_id"], 1)], payment_method="TRANSFER")
    assert refused.json()["detail"]["code"] == "PAYMENT_METHOD_UNAVAILABLE"


# ---- placing: Pending, reserved, no deadline, no expiry -------------------------------------


async def test_cod_is_unchanged(client, make_product, admin_h, db_engine):
    p = await make_product(stock_quantity=5)
    r = await place(client, [(p["product_id"], 2)])
    order = r.json()
    assert r.status_code == 201
    assert (order["status"], order["payment_status"]) == ("PENDING", "PENDING")
    assert order["payment_deadline_at"] is None
    assert await stock_of(db_engine, p["product_id"]) == 3
    assert (
        await client.post(
            f"{ORDERS}/{order['order_id']}/mark-paid",
            headers=admin_h,
            json={"amount_paisa": order["total_amount_paisa"]},
        )
    ).status_code == 409  # not a wallet order
    for step in ("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"):
        r = await client.post(
            f"{ORDERS}/{order['order_id']}/status", headers=admin_h, json={"status": step}
        )
        assert r.status_code == 200, r.text
    paid = await client.post(f"{ORDERS}/{order['order_id']}/confirm-cod-payment", headers=admin_h)
    assert paid.status_code == 200 and paid.json()["payment_status"] == "PAID"


@pytest.mark.parametrize("method", ["EASYPAISA", "JAZZCASH"])
async def test_a_wallet_order_stays_pending_without_a_deadline_and_never_expires(
    client, make_product, wallets, db_engine, method
):
    p, order = await wallet_order(client, make_product, method)
    assert (order["status"], order["payment_status"]) == ("PENDING", "PENDING")
    assert order["payment_deadline_at"] is None
    assert await stock_of(db_engine, p["product_id"]) == 3  # reserved like COD
    async with db_engine.begin() as conn:
        # even a long time later, the expiry function leaves it alone
        await conn.execute(text("UPDATE orders SET created_at = now() - interval '30 days'"))
        expired = (await conn.execute(text("SELECT expire_unpaid_online_orders()"))).scalar()
    assert expired == 0
    assert await stock_of(db_engine, p["product_id"]) == 3
    row = await payment_row(db_engine, order["order_id"])
    assert row["status"] == "PENDING"


async def test_the_order_cannot_be_confirmed_by_a_plain_status_change(
    client, make_product, wallets, admin_h
):
    _, order = await wallet_order(client, make_product)
    r = await client.post(
        f"{ORDERS}/{order['order_id']}/status", headers=admin_h, json={"status": "CONFIRMED"}
    )
    assert r.status_code == 409 and r.json()["detail"]["code"] == "PAYMENT_NOT_VERIFIED"


# ---- mark as paid ------------------------------------------------------------------------------


async def test_mark_as_paid_confirms_the_order_and_records_who_and_when(
    client, make_product, wallets, admin_h, db_engine, emails, make_token
):
    _, order = await wallet_order(client, make_product)
    emails.sent.clear()
    admin_id = uuid.uuid4()
    headers = auth(make_token(admin=True, sub=admin_id, aal="aal2"))
    r = await mark(client, headers, order, reference="  TX-5544332211 ", note="Paid at 3pm")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["status"], body["payment_status"]) == ("CONFIRMED", "PAID")
    row = await payment_row(db_engine, order["order_id"])
    assert row["paid_marked_by"] == admin_id and row["paid_marked_at"] is not None
    assert row["paid_reference"] == "TX-5544332211" and row["paid_note"] == "Paid at 3pm"
    [payment] = body["payments"]
    assert payment["paid_marked_by"] == str(admin_id)
    assert len(emails.to("ayesha@example.com")) == 2  # payment received + order confirmed


async def test_the_reference_and_note_are_optional(client, make_product, wallets, admin_h):
    _, order = await wallet_order(client, make_product, "JAZZCASH")
    r = await mark(client, admin_h, order)
    assert r.status_code == 200 and r.json()["status"] == "CONFIRMED"


async def test_the_amount_must_be_exactly_the_order_total(
    client, make_product, wallets, admin_h, db_engine
):
    _, order = await wallet_order(client, make_product)
    for wrong in (order["total_amount_paisa"] - 1, order["total_amount_paisa"] + 1):
        r = await mark(client, admin_h, order, amount=wrong)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "AMOUNT_MISMATCH"
    bad_ref = await mark(client, admin_h, order, reference="no spaces allowed!")
    assert bad_ref.status_code == 422
    row = await payment_row(db_engine, order["order_id"])
    assert row["status"] == "PENDING"  # nothing changed


async def test_double_clicks_and_two_admins_give_exactly_one_success(
    client, make_product, wallets, admin_h, db_engine, emails
):
    _, order = await wallet_order(client, make_product)
    emails.sent.clear()
    results = await asyncio.gather(*(mark(client, admin_h, order) for _ in range(5)))
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409, 409]
    assert {r.json()["detail"]["code"] for r in results if r.status_code == 409} == {"ALREADY_PAID"}
    assert len(emails.to("ayesha@example.com")) == 2  # told once, not five times
    async with db_engine.connect() as conn:
        paid = (
            await conn.execute(text("SELECT count(*) FROM payments WHERE status='PAID'"))
        ).scalar()
    assert paid == 1


async def test_only_an_admin_with_the_second_factor_can_mark_as_paid(
    client, make_product, wallets, customer_h, make_token, db_engine
):
    _, order = await wallet_order(client, make_product)
    url = f"{ORDERS}/{order['order_id']}/mark-paid"
    body = {"amount_paisa": order["total_amount_paisa"]}
    assert (await client.post(url, json=body)).status_code == 401  # no token
    assert (await client.post(url, json=body, headers=customer_h)).status_code == 403  # a customer
    no_mfa = auth(make_token(admin=True, aal="aal1"))
    r = await client.post(url, json=body, headers=no_mfa)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "MFA_REQUIRED"
    assert (await payment_row(db_engine, order["order_id"]))["status"] == "PENDING"


async def test_only_wallet_orders_can_be_marked_paid(client, make_product, wallets, admin_h):
    p = await make_product(stock_quantity=5)
    cod = (await place(client, [(p["product_id"], 1)])).json()
    r = await mark(client, admin_h, cod)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_A_MANUAL_PAYMENT"
    assert (
        await mark(client, admin_h, {"order_id": str(uuid.uuid4()), "total_amount_paisa": 1})
    ).status_code == 404


async def test_a_confirmed_order_moves_on_normally_after_being_marked_paid(
    client, make_product, wallets, admin_h
):
    _, order = await wallet_order(client, make_product)
    await mark(client, admin_h, order)
    for step in ("PROCESSING", "SHIPPED", "DELIVERED"):
        r = await client.post(
            f"{ORDERS}/{order['order_id']}/status", headers=admin_h, json={"status": step}
        )
        assert r.status_code == 200, r.text


async def test_mark_as_paid_is_written_to_the_audit_log(
    client, make_product, wallets, admin_h, db_engine
):
    _, order = await wallet_order(client, make_product)
    await mark(client, admin_h, order)
    async with db_engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT action, status_code FROM admin_audit_log WHERE action LIKE '%mark-paid'"
                )
            )
        ).all()
    assert rows == [("POST /api/admin/orders/{id}/mark-paid", 200)]


# ---- cancelling an unpaid wallet order; money arriving after a cancellation --------------------


async def test_cancelling_an_unpaid_wallet_order_releases_the_stock(
    client, make_product, wallets, admin_h, db_engine
):
    p, order = await wallet_order(client, make_product)
    assert await stock_of(db_engine, p["product_id"]) == 3
    r = await client.post(f"{ORDERS}/{order['order_id']}/cancel", headers=admin_h, json={})
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"
    assert await stock_of(db_engine, p["product_id"]) == 5
    assert r.json()["refund_due_paisa"] == 0  # nothing was paid


async def test_money_that_arrives_after_a_cancellation_is_recorded_and_refundable_in_full(
    client, make_product, wallets, admin_h, db_engine
):
    p, order = await wallet_order(client, make_product)
    await client.post(f"{ORDERS}/{order['order_id']}/cancel", headers=admin_h, json={})
    r = await mark(client, admin_h, order, reference="TX-LATE-0001")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["status"], body["payment_status"]) == ("CANCELLED", "PAID")  # never reopened
    assert body["refund_due_paisa"] == order["total_amount_paisa"]
    assert await stock_of(db_engine, p["product_id"]) == 5  # stock stays released
    refund = await client.post(
        f"{ORDERS}/{order['order_id']}/refund",
        headers=admin_h,
        json={"wallet_reference": "RF-1234567"},
    )
    assert refund.status_code == 200 and refund.json()["payment_status"] == "REFUNDED"


# ---- refunds keep a trace -----------------------------------------------------------------------


async def test_each_refund_step_keeps_its_wallet_reference_and_the_admin(
    client, make_product, wallets, db_engine, make_token
):
    _, order = await wallet_order(client, make_product)
    admin_id = uuid.uuid4()
    headers = auth(make_token(admin=True, sub=admin_id, aal="aal2"))
    await mark(client, headers, order)
    await client.post(f"{ORDERS}/{order['order_id']}/cancel", headers=headers, json={})
    first = await client.post(
        f"{ORDERS}/{order['order_id']}/refund",
        headers=headers,
        json={"amount_paisa": 100, "wallet_reference": " RF-0001-AB "},
    )
    second = await client.post(f"{ORDERS}/{order['order_id']}/refund", headers=headers, json={})
    assert first.status_code == 200 and second.status_code == 200, second.text
    refunds = second.json()["payments"][0]["refunds"]
    assert [(r["amount_paisa"], r["wallet_reference"]) for r in refunds] == [
        (100, "RF-0001-AB"),
        (order["total_amount_paisa"] - 100, None),
    ]
    assert all(r["recorded_by"] == str(admin_id) for r in refunds)
    bad = await client.post(
        f"{ORDERS}/{order['order_id']}/refund", headers=headers, json={"wallet_reference": "!!"}
    )
    assert bad.status_code == 422


# ---- finding unpaid orders ----------------------------------------------------------------------


async def test_the_orders_list_can_show_only_orders_awaiting_payment(
    client, make_product, wallets, admin_h
):
    p = await make_product(stock_quantity=9)
    cod = (await place(client, [(p["product_id"], 1)])).json()
    waiting = (await place(client, [(p["product_id"], 1)], payment_method="EASYPAISA")).json()
    paid = (await place(client, [(p["product_id"], 1)], payment_method="JAZZCASH")).json()
    cancelled = (await place(client, [(p["product_id"], 1)], payment_method="EASYPAISA")).json()
    await mark(client, admin_h, paid)
    await client.post(f"{ORDERS}/{cancelled['order_id']}/cancel", headers=admin_h, json={})

    async def ids(query):
        r = await client.get(f"{ORDERS}?{query}", headers=admin_h)
        assert r.status_code == 200
        return {o["order_id"] for o in r.json()["items"]}

    assert await ids("awaiting_payment=true") == {waiting["order_id"]}
    everything = await ids("awaiting_payment=false")
    assert {cod["order_id"], waiting["order_id"], paid["order_id"]} <= everything


# ---- switched off means refused -----------------------------------------------------------------


async def test_the_receipt_routes_refuse_while_the_flag_is_off(
    client, make_product, wallets, admin_h, customer_h
):
    _, order = await wallet_order(client, make_product)
    oid = order["order_id"]
    attempt = f"payment-proofs/{uuid.uuid4().hex}.png"
    calls = [
        client.post(
            f"/api/orders/{oid}/payment-proof/upload-url", json={"content_type": "image/png"}
        ),
        client.post(
            f"/api/orders/{oid}/payment-proof",
            json={"reference": "TX1234567", "image_path": attempt},
        ),
        client.get(f"/api/orders/{oid}/payment-attempts"),
        client.get("/api/admin/payments", headers=admin_h),
        client.get(f"/api/admin/payments/{uuid.uuid4()}", headers=admin_h),
        client.get(f"/api/admin/payments/{uuid.uuid4()}/receipt", headers=admin_h),
        client.post(f"/api/admin/payments/{uuid.uuid4()}/verify", headers=admin_h),
        client.post(
            f"/api/admin/payments/{uuid.uuid4()}/reject",
            headers=admin_h,
            json={"reason": "NOT_RECEIVED"},
        ),
    ]
    for response in await asyncio.gather(*calls):
        assert response.status_code == 403, response.text
        assert response.json()["detail"]["code"] == "FEATURE_DISABLED"
    # a customer token is still refused as before (the admin check comes first)
    assert (await client.get("/api/admin/payments", headers=customer_h)).status_code == 403
    assert (await client.get("/api/admin/payments")).status_code == 401


async def test_mark_as_paid_is_refused_while_the_receipt_flow_is_on(
    client, make_product, wallets, admin_h, receipts_on
):
    saved = await client.patch(
        "/api/admin/settings",
        headers=admin_h,
        json={"easypaisa_qr_path": f"payment-qr/{'1' * 32}.png"},
    )
    assert saved.status_code == 200
    _, order = await wallet_order(client, make_product)
    assert order["payment_deadline_at"] is not None  # the 30-minute window is back
    r = await mark(client, admin_h, order)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "USE_PAYMENTS_QUEUE"


async def test_the_public_settings_say_whether_receipts_are_on(client, receipts_on):
    r = await client.get("/api/settings")
    assert r.status_code == 200 and r.json()["wallet_receipts_enabled"] is True


async def test_the_public_settings_say_receipts_are_off_by_default(client):
    r = await client.get("/api/settings")
    assert r.status_code == 200 and r.json()["wallet_receipts_enabled"] is False


# ---- the settings-change alert (audit P12) ------------------------------------------------------


async def test_changing_a_wallet_setting_emails_the_shop(client, admin_h, db_engine, emails):
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = 'shop@example.com'"))
    emails.sent.clear()
    r = await client.patch(
        "/api/admin/settings", headers=admin_h, json={"easypaisa_details": "0300 7654321"}
    )
    assert r.status_code == 200, r.text
    [alert] = emails.to("shop@example.com")
    assert "Easypaisa account details" in alert.body and "changed" in alert.subject
    assert "JazzCash" not in alert.body  # only what changed

    emails.sent.clear()
    await client.patch(
        "/api/admin/settings",
        headers=admin_h,
        json={"jazzcash_qr_path": f"payment-qr/{'3' * 32}.png", "easypaisa_details": None},
    )
    [alert] = emails.to("shop@example.com")
    assert "JazzCash QR code" in alert.body and "Easypaisa account details" in alert.body


async def test_other_settings_changes_and_unchanged_values_send_no_alert(
    client, admin_h, db_engine, emails
):
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE business_settings SET email = 'shop@example.com', easypaisa_details = 'x'")
        )
    emails.sent.clear()
    await client.patch("/api/admin/settings", headers=admin_h, json={"business_name": "New name"})
    await client.patch("/api/admin/settings", headers=admin_h, json={"easypaisa_details": "x"})
    assert emails.sent == []


async def test_the_alert_also_reaches_the_old_address_when_the_email_is_swapped_too(
    client, admin_h, db_engine, emails
):
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = 'owner@example.com'"))
    emails.sent.clear()
    r = await client.patch(
        "/api/admin/settings",
        headers=admin_h,
        json={"email": "thief@example.net", "jazzcash_details": "0333 0000000"},
    )
    assert r.status_code == 200
    assert len(emails.to("owner@example.com")) == 1  # the address from BEFORE the change
    assert len(emails.to("thief@example.net")) == 1


async def test_a_customer_cancelling_their_own_unpaid_wallet_order_returns_the_stock(
    client, make_product, wallets, make_token, db_engine
):
    uid = uuid.uuid4()
    headers = auth(make_token(sub=uid, email="reg@example.com", name="Reg"))
    p, order = await wallet_order(client, make_product, headers=headers)
    assert await stock_of(db_engine, p["product_id"]) == 3
    r = await client.post(f"/api/orders/{order['order_id']}/cancel", headers=headers)
    assert r.status_code == 200, r.text
    assert await stock_of(db_engine, p["product_id"]) == 5
