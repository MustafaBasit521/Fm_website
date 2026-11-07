"""The Easypaisa / JazzCash RECEIPT flow (MANUAL_RECEIPTS_ENABLED): the customer sends a
transaction number and a receipt, and only an admin can mark the payment as paid.

The flow is switched off at launch (business-rules §13), so every test here runs with it switched
on. The launch behaviour (flag off) is tested in test_wallet_simple.py."""

import asyncio
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth
from tests.test_checkout import place, stock_of
from tests.test_orders_customer import set_status


@pytest.fixture(autouse=True)
def _receipt_flow_on(receipts_on):
    """This whole file tests the receipt flow, so it needs the flag."""


ADMIN = "/api/admin/orders"
PAYMENTS = "/api/admin/payments"
QR = {"easypaisa": f"payment-qr/{'1' * 32}.png", "jazzcash": f"payment-qr/{'2' * 32}.png"}


def receipt() -> str:
    return f"payment-proofs/{uuid.uuid4().hex}.png"


def details(reference: str = "TX1234567890", image: str | None = None) -> dict:
    return {"reference": reference, "image_path": image or receipt()}


@pytest.fixture
async def wallets_on(db_engine):
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE business_settings SET easypaisa_qr_path = :e, jazzcash_qr_path = :j"),
            {"e": QR["easypaisa"], "j": QR["jazzcash"]},
        )


async def wallet_order(client, make_product, method="EASYPAISA", headers=None, **over):
    p = await make_product(stock_quantity=5)
    r = await place(client, [(p["product_id"], 2)], payment_method=method, headers=headers, **over)
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


async def submit(client, order_id, body=None, headers=None):
    return await client.post(
        f"/api/orders/{order_id}/payment-proof",
        json=details() if body is None else body,
        headers=headers,
    )


async def queue(client, admin_h, status=None):
    url = PAYMENTS + (f"?status={status}" if status else "")
    r = await client.get(url, headers=admin_h)
    assert r.status_code == 200, r.text
    return r.json()["items"]


# ---- offering the methods ------------------------------------------------------------------


async def test_a_wallet_is_offered_only_when_its_qr_code_exists(client, make_product, db_engine):
    p = await make_product(stock_quantity=5)
    items = {"items": [{"product_id": p["product_id"], "quantity": 1}]}

    async def methods():
        return (await client.post("/api/checkout/quote", json=items)).json()["payment_methods"]

    assert await methods() == ["COD"]
    refused = await place(client, [(p["product_id"], 1)], payment_method="EASYPAISA")
    assert (
        refused.status_code == 422
        and refused.json()["detail"]["code"] == "PAYMENT_METHOD_UNAVAILABLE"
    )
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE business_settings SET jazzcash_qr_path = :j"), {"j": QR["jazzcash"]}
        )
    assert await methods() == ["COD", "JAZZCASH"]
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE business_settings SET easypaisa_qr_path = :e"), {"e": QR["easypaisa"]}
        )
    assert await methods() == ["COD", "EASYPAISA", "JAZZCASH"]


async def test_the_old_generic_transfer_method_is_no_longer_offered(
    client, make_product, wallets_on
):
    p = await make_product(stock_quantity=5)
    r = await place(client, [(p["product_id"], 1)], payment_method="TRANSFER")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "PAYMENT_METHOD_UNAVAILABLE"


async def test_the_public_settings_show_the_qr_codes_and_details(client, admin_h, wallets_on):
    assert (await client.get("/api/settings")).json()["easypaisa_qr_url"].endswith(QR["easypaisa"])
    r = await client.patch(
        "/api/admin/settings",
        headers=admin_h,
        json={"jazzcash_details": "  Sara Ahmed 0300 1234567  "},
    )
    assert r.status_code == 200
    public = (await client.get("/api/settings")).json()
    assert public["jazzcash_details"] == "Sara Ahmed 0300 1234567"
    assert public["jazzcash_qr_url"].endswith(QR["jazzcash"])


async def test_the_admin_sets_and_removes_a_qr_code(client, admin_h, customer_h, storage):
    url = "/api/admin/settings/payment-qr/upload-url"
    assert (await client.post(url, json={"content_type": "image/png"})).status_code == 401
    assert (
        await client.post(url, headers=customer_h, json={"content_type": "image/png"})
    ).status_code == 403
    up = await client.post(url, headers=admin_h, json={"content_type": "image/png"})
    assert up.status_code == 200 and up.json()["storage_path"].startswith("payment-qr/")
    bad = await client.patch(
        "/api/admin/settings", headers=admin_h, json={"easypaisa_qr_path": "../../x.png"}
    )
    assert bad.status_code == 422
    ok = await client.patch(
        "/api/admin/settings", headers=admin_h, json={"easypaisa_qr_path": QR["easypaisa"]}
    )
    assert ok.json()["easypaisa_qr_url"].endswith(QR["easypaisa"])
    gone = await client.patch(
        "/api/admin/settings", headers=admin_h, json={"easypaisa_qr_path": None}
    )
    assert gone.json()["easypaisa_qr_url"] is None


# ---- placing: COD, Easypaisa, JazzCash -----------------------------------------------------


async def test_cod_still_works_with_the_wallets_switched_on(client, make_product, wallets_on):
    p = await make_product(stock_quantity=5)
    r = await place(client, [(p["product_id"], 1)], payment_method="COD")
    assert r.status_code == 201
    assert r.json()["payment_method"] == "COD" and r.json()["payment_deadline_at"] is None


@pytest.mark.parametrize("method", ["EASYPAISA", "JAZZCASH"])
async def test_a_wallet_order_reserves_stock_and_starts_the_30_minute_window(
    client, make_product, wallets_on, db_engine, method
):
    p, order = await wallet_order(client, make_product, method)
    assert (order["status"], order["payment_method"], order["payment_status"]) == (
        "PENDING",
        method,
        "PENDING",
    )
    assert order["payment_deadline_at"] is not None and order["proof_submitted_at"] is None
    assert order["payment_attempts"] == []
    assert await stock_of(db_engine, p["product_id"]) == 3


async def test_without_details_the_order_expires_and_returns_the_stock(
    client, make_product, wallets_on, db_engine
):
    p, order = await wallet_order(client, make_product)
    assert await expire(db_engine, order["order_id"]) == 1
    assert await stock_of(db_engine, p["product_id"]) == 5
    late = await submit(client, order["order_id"])
    assert late.status_code == 409 and late.json()["detail"]["code"] == "PAYMENT_CLOSED"


# ---- the customer sends the transaction number and the receipt ----------------------------


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"reference": "TX1234567890"},  # a receipt is needed too
        {"image_path": f"payment-proofs/{'b' * 32}.png"},  # and a number
        {"reference": "  ", "image_path": f"payment-proofs/{'b' * 32}.png"},
        {"reference": "123", "image_path": f"payment-proofs/{'b' * 32}.png"},  # too short
        {"reference": "TX 123 456 789", "image_path": f"payment-proofs/{'b' * 32}.png"},
        {"reference": "TX1234567890", "image_path": "gallery/x.png"},
        {"reference": "TX1234567890", "image_path": "payment-proofs/../x.png"},
        {"reference": "TX1234567890", "image_path": f"payment-proofs/{'b' * 32}.pdf"},
        {"reference": "TX1234567890", "image_path": f"payment-proofs/{'b' * 32}.png", "x": 1},
    ],
)
async def test_both_a_valid_number_and_a_valid_receipt_are_needed(
    client, make_product, wallets_on, body
):
    _, order = await wallet_order(client, make_product)
    assert (await submit(client, order["order_id"], body)).status_code == 422


async def test_sending_details_stops_the_clock_and_tells_the_shop(
    client, make_product, wallets_on, db_engine, emails
):
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = 'shop@example.com'"))
    p, order = await wallet_order(client, make_product)
    oid = order["order_id"]
    emails.sent.clear()
    r = await submit(client, oid, details("  TX-998877  "))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["proof_submitted_at"] is not None
    assert (body["status"], body["payment_status"]) == ("PENDING", "PENDING")  # an admin decides
    assert body["payment_deadline_at"] is None and await deadline(db_engine, oid) is None
    [attempt] = body["payment_attempts"]
    assert attempt["status"] == "SUBMITTED" and attempt["transaction_reference"] == "TX-998877"
    assert attempt["amount_paisa"] == body["total_amount_paisa"]  # the server's total
    assert "reviewed_by" not in attempt  # the customer never sees admin ids
    alert = emails.to("shop@example.com")
    assert len(alert) == 1 and "TX-998877" in alert[0].body
    assert len(emails.to("ayesha@example.com")) == 1
    # while the shop checks there is no deadline, so the order does not expire
    assert await run_expiry(db_engine) == 0
    assert await stock_of(db_engine, p["product_id"]) == 3


async def test_a_second_submission_is_refused_while_the_first_is_being_checked(
    client, make_product, wallets_on
):
    _, order = await wallet_order(client, make_product)
    await submit(client, order["order_id"])
    again = await submit(client, order["order_id"], details("OTHER-9988776655"))
    assert again.status_code == 409 and again.json()["detail"]["code"] == "ALREADY_SUBMITTED"


async def test_the_details_route_only_works_for_wallet_orders(client, make_product, wallets_on):
    p = await make_product(stock_quantity=5)
    cod = (await place(client, [(p["product_id"], 1)])).json()
    r = await submit(client, cod["order_id"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_A_MANUAL_PAYMENT"
    assert (await submit(client, str(uuid.uuid4()))).status_code == 404


async def test_a_transaction_number_cannot_be_used_twice_even_on_another_order(
    client, make_product, wallets_on
):
    _, first = await wallet_order(client, make_product)
    _, second = await wallet_order(client, make_product, "JAZZCASH")
    assert (await submit(client, first["order_id"], details("TX-DUPLICATE-1"))).status_code == 200
    dup = await submit(
        client, second["order_id"], details("tx-duplicate-1")
    )  # case does not matter
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "DUPLICATE_REFERENCE"
    # the refused attempt left nothing behind and did not stop the second order's clock
    assert (await client.get(f"/api/orders/{second['order_id']}/payment-attempts")).json() == []


async def test_a_receipt_file_cannot_back_two_submissions(client, make_product, wallets_on):
    _, first = await wallet_order(client, make_product)
    _, second = await wallet_order(client, make_product)
    shared = receipt()
    assert (
        await submit(client, first["order_id"], details("TX-AAAAAA-1", shared))
    ).status_code == 200
    r = await submit(client, second["order_id"], details("TX-BBBBBB-2", shared))
    assert r.status_code == 409


async def test_upload_urls_are_given_only_for_open_wallet_orders(
    client, make_product, wallets_on, storage, db_engine
):
    _, order = await wallet_order(client, make_product)
    url = f"/api/orders/{order['order_id']}/payment-proof/upload-url"
    r = await client.post(url, json={"content_type": "image/png"})
    assert r.status_code == 200
    body = r.json()
    assert body["bucket"] == "payment-proofs" and body["storage_path"].startswith("payment-proofs/")
    assert (await client.post(url, json={"content_type": "application/pdf"})).status_code == 422
    await expire(db_engine, order["order_id"])
    assert (await client.post(url, json={"content_type": "image/png"})).status_code == 409


# ---- who may touch a registered customer's order -------------------------------------------


async def test_only_the_owner_can_send_details_or_read_the_history(
    client, make_product, wallets_on, make_token
):
    mine = auth(make_token(email="mine@example.com"))
    theirs = auth(make_token(email="theirs@example.com"))
    _, order = await wallet_order(client, make_product, headers=mine)
    oid = order["order_id"]
    for headers in (None, theirs):  # a stranger, with or without an account
        assert (await submit(client, oid, headers=headers)).status_code == 404
        up = await client.post(
            f"/api/orders/{oid}/payment-proof/upload-url",
            json={"content_type": "image/png"},
            headers=headers,
        )
        assert up.status_code == 404
        hist = await client.get(f"/api/orders/{oid}/payment-attempts", headers=headers)
        assert hist.status_code == 404
    assert (await submit(client, oid, headers=mine)).status_code == 200
    mine_hist = await client.get(f"/api/orders/{oid}/payment-attempts", headers=mine)
    assert [a["status"] for a in mine_hist.json()] == ["SUBMITTED"]
    assert "reviewed_by" not in mine_hist.json()[0]


# ---- the admin queue ------------------------------------------------------------------------


async def test_the_queue_lists_submissions_with_what_the_admin_needs(
    client, admin_h, make_product, wallets_on
):
    _, order = await wallet_order(client, make_product, "JAZZCASH")
    assert await queue(client, admin_h) == []  # nothing submitted yet
    await submit(client, order["order_id"], details("TX-QUEUE-0001"))
    [row] = await queue(client, admin_h)
    assert row["order_id"] == order["order_id"] and row["status"] == "SUBMITTED"
    assert row["method"] == "JAZZCASH" and row["transaction_reference"] == "TX-QUEUE-0001"
    assert row["amount_paisa"] == row["order_total_paisa"] == order["total_amount_paisa"]
    assert (row["customer_name"], row["customer_email"]) == ("Ayesha Khan", "ayesha@example.com")
    assert row["reviewed_by"] is None
    assert await queue(client, admin_h, "REJECTED") == []
    assert len(await queue(client, admin_h, "SUBMITTED")) == 1
    bad = await client.get(f"{PAYMENTS}?status=NOPE", headers=admin_h)
    assert bad.status_code == 422


async def test_the_receipt_link_is_private_and_only_for_admins(
    client, admin_h, customer_h, make_product, wallets_on
):
    _, order = await wallet_order(client, make_product)
    image = receipt()
    await submit(client, order["order_id"], details(image=image))
    [row] = await queue(client, admin_h)
    url = f"{PAYMENTS}/{row['attempt_id']}/receipt"
    assert (await client.get(url)).status_code == 401
    assert (await client.get(url, headers=customer_h)).status_code == 403
    link = (await client.get(url, headers=admin_h)).json()["url"]
    assert link.startswith("https://down.example/payment-proofs/") and image in link


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "", None),
        ("GET", "/{id}", None),
        ("GET", "/{id}/receipt", None),
        ("POST", "/{id}/verify", {}),
        ("POST", "/{id}/reject", {"reason": "NOT_RECEIVED"}),
    ],
)
async def test_every_payment_admin_route_needs_the_admin_role(
    client, customer_h, method, path, body
):
    url = PAYMENTS + path.replace("{id}", str(uuid.uuid4()))
    assert (await client.request(method, url, json=body)).status_code == 401
    assert (await client.request(method, url, json=body, headers=customer_h)).status_code == 403


async def test_admin_routes_need_the_second_factor(client, make_token, make_product, wallets_on):
    no_mfa = auth(make_token(admin=True, aal="aal1"))
    r = await client.post(f"{PAYMENTS}/{uuid.uuid4()}/verify", headers=no_mfa)
    assert r.status_code == 403


# ---- verifying ------------------------------------------------------------------------------


async def test_verifying_pays_the_payment_confirms_the_order_and_records_the_admin(
    client, admin_h, make_token, make_product, wallets_on, emails, db_engine
):
    admin_id = uuid.uuid4()
    admin = auth(make_token(admin=True, sub=admin_id, email="boss@example.com"))
    _, order = await wallet_order(client, make_product)
    oid = order["order_id"]
    # a plain status change cannot confirm an unpaid wallet order
    early = await client.post(f"{ADMIN}/{oid}/status", headers=admin, json={"status": "CONFIRMED"})
    assert early.status_code == 409 and early.json()["detail"]["code"] == "PAYMENT_NOT_VERIFIED"
    await submit(client, oid)
    [row] = await queue(client, admin)
    emails.sent.clear()
    r = await client.post(f"{PAYMENTS}/{row['attempt_id']}/verify", headers=admin)
    assert r.status_code == 200, r.text
    done = r.json()
    assert done["status"] == "PAID" and done["order_status"] == "CONFIRMED"
    assert done["reviewed_by"] == str(admin_id) and done["reviewed_at"] is not None
    seen = (await client.get(f"{ADMIN}/{oid}", headers=admin)).json()
    assert (seen["status"], seen["payment_status"]) == ("CONFIRMED", "PAID")
    assert seen["payments"][0]["attempts"][0]["status"] == "PAID"
    assert any("Payment received" in m.subject for m in emails.to("ayesha@example.com"))
    # the order can now move on: preparation starts only after the payment was verified
    assert (
        await client.post(f"{ADMIN}/{oid}/status", headers=admin, json={"status": "PROCESSING"})
    ).status_code == 200


async def test_the_same_payment_cannot_be_verified_or_rejected_twice(
    client, admin_h, make_product, wallets_on
):
    _, order = await wallet_order(client, make_product)
    await submit(client, order["order_id"])
    [row] = await queue(client, admin_h)
    first = await client.post(f"{PAYMENTS}/{row['attempt_id']}/verify", headers=admin_h)
    assert first.status_code == 200
    again = await client.post(f"{PAYMENTS}/{row['attempt_id']}/verify", headers=admin_h)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "ALREADY_REVIEWED"
    reject = await client.post(
        f"{PAYMENTS}/{row['attempt_id']}/reject", headers=admin_h, json={"reason": "NOT_RECEIVED"}
    )
    assert reject.status_code == 409 and reject.json()["detail"]["code"] == "ALREADY_REVIEWED"


async def test_two_admins_verifying_at_the_same_moment_succeed_only_once(
    client, admin_h, make_product, wallets_on, db_engine
):
    _, order = await wallet_order(client, make_product)
    await submit(client, order["order_id"])
    [row] = await queue(client, admin_h)
    url = f"{PAYMENTS}/{row['attempt_id']}/verify"
    results = await asyncio.gather(*(client.post(url, headers=admin_h) for _ in range(4)))
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409]
    async with db_engine.connect() as conn:
        paid = (
            await conn.execute(text("SELECT count(*) FROM payments WHERE status = 'PAID'"))
        ).scalar()
    assert paid == 1


async def test_nothing_can_be_verified_that_was_never_submitted(
    client, admin_h, make_product, wallets_on
):
    _, order = await wallet_order(client, make_product)
    # no attempt exists, so there is nothing to verify (the customer's word is never enough)
    r = await client.post(f"{PAYMENTS}/{uuid.uuid4()}/verify", headers=admin_h)
    assert r.status_code == 404
    seen = (await client.get(f"{ADMIN}/{order['order_id']}", headers=admin_h)).json()
    assert seen["payment_status"] == "PENDING"


async def test_a_cancelled_order_cannot_have_its_payment_verified(
    client, admin_h, make_product, wallets_on, db_engine
):
    _, order = await wallet_order(client, make_product)
    await submit(client, order["order_id"])
    [row] = await queue(client, admin_h)
    await client.post(f"{ADMIN}/{order['order_id']}/cancel", headers=admin_h, json={})
    r = await client.post(f"{PAYMENTS}/{row['attempt_id']}/verify", headers=admin_h)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ORDER_NOT_OPEN"


# ---- rejecting ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"reason": ""},
        {"reason": "BECAUSE"},
        {"reason": "OTHER"},
        {"reason": "OTHER", "note": " "},
    ],
)
async def test_rejecting_needs_a_valid_reason(client, admin_h, make_product, wallets_on, body):
    _, order = await wallet_order(client, make_product)
    await submit(client, order["order_id"])
    [row] = await queue(client, admin_h)
    r = await client.post(f"{PAYMENTS}/{row['attempt_id']}/reject", headers=admin_h, json=body)
    assert r.status_code == 422
    assert (await queue(client, admin_h))[0]["status"] == "SUBMITTED"  # nothing changed


async def test_a_rejected_payment_keeps_the_order_out_of_preparation_and_tells_the_customer_why(
    client, admin_h, make_token, make_product, wallets_on, db_engine, emails
):
    admin_id = uuid.uuid4()
    admin = auth(make_token(admin=True, sub=admin_id))
    _, order = await wallet_order(client, make_product)
    oid = order["order_id"]
    await submit(client, oid, details("WRONG-NUMBER-1"))
    [row] = await queue(client, admin)
    emails.sent.clear()
    r = await client.post(
        f"{PAYMENTS}/{row['attempt_id']}/reject",
        headers=admin,
        json={"reason": "AMOUNT_MISMATCH", "note": "Rs 1,000 arrived"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "REJECTED" and r.json()["reviewed_by"] == str(admin_id)
    assert r.json()["rejection_reason"] == "AMOUNT_MISMATCH"
    seen = (await client.get(f"{ADMIN}/{oid}", headers=admin)).json()
    assert (seen["status"], seen["payment_status"]) == ("PENDING", "PENDING")
    assert seen["proof_submitted_at"] is None and seen["payment_deadline_at"] is not None
    early = await client.post(f"{ADMIN}/{oid}/status", headers=admin, json={"status": "CONFIRMED"})
    assert early.status_code == 409
    # the customer is told, with the reason
    mail = [m for m in emails.to("ayesha@example.com") if "not accepted" in m.subject]
    assert len(mail) == 1 and "amount does not match" in mail[0].body
    assert "Rs 1,000 arrived" in mail[0].body
    # and sees it on the order and in the history
    [attempt] = (await client.get(f"/api/orders/{oid}/payment-attempts")).json()
    assert attempt["status"] == "REJECTED" and attempt["rejection_reason"] == "AMOUNT_MISMATCH"
    assert attempt["rejection_note"] == "Rs 1,000 arrived" and "reviewed_by" not in attempt


async def test_a_corrected_attempt_is_a_new_record_and_the_history_is_kept(
    client, admin_h, make_product, wallets_on, db_engine
):
    _, order = await wallet_order(client, make_product)
    oid = order["order_id"]
    await submit(client, oid, details("WRONG-NUMBER-1"))
    [row] = await queue(client, admin_h)
    await client.post(
        f"{PAYMENTS}/{row['attempt_id']}/reject", headers=admin_h, json={"reason": "NOT_RECEIVED"}
    )
    # a rejected number may be sent again (e.g. the same payment with a clearer receipt)
    retry = await submit(client, oid, details("WRONG-NUMBER-1"))
    assert retry.status_code == 200, retry.text
    assert [a["status"] for a in retry.json()["payment_attempts"]] == ["REJECTED", "SUBMITTED"]
    assert retry.json()["payment_deadline_at"] is None
    rows = await queue(client, admin_h)
    assert len(rows) == 2
    [open_row] = await queue(client, admin_h, "SUBMITTED")
    ok = await client.post(f"{PAYMENTS}/{open_row['attempt_id']}/verify", headers=admin_h)
    assert ok.status_code == 200 and ok.json()["order_status"] == "CONFIRMED"
    final = (await client.get(f"/api/admin/orders/{oid}", headers=admin_h)).json()
    assert [a["status"] for a in final["payments"][0]["attempts"]] == ["REJECTED", "PAID"]


async def test_if_the_customer_does_not_retry_the_order_expires(
    client, admin_h, make_product, wallets_on, db_engine
):
    p, order = await wallet_order(client, make_product)
    await submit(client, order["order_id"])
    [row] = await queue(client, admin_h)
    await client.post(
        f"{PAYMENTS}/{row['attempt_id']}/reject", headers=admin_h, json={"reason": "NOT_RECEIVED"}
    )
    assert await expire(db_engine, order["order_id"]) == 1
    assert await stock_of(db_engine, p["product_id"]) == 5


# ---- database rules -------------------------------------------------------------------------


async def test_the_database_itself_refuses_inconsistent_attempts(
    client, make_product, wallets_on, db_engine
):
    from sqlalchemy.exc import IntegrityError

    _, order = await wallet_order(client, make_product)
    await submit(client, order["order_id"])
    for sql in (
        "UPDATE payment_attempts SET status = 'PAID'",  # decided without an admin
        "UPDATE payment_attempts SET status = 'REJECTED', reviewed_by = gen_random_uuid(), "
        "reviewed_at = now()",  # rejected without a reason
        "UPDATE payment_attempts SET amount_paisa = -1",
        "UPDATE payment_attempts SET transaction_reference = '  '",
    ):
        with pytest.raises(IntegrityError):
            async with db_engine.begin() as conn:
                await conn.execute(text(sql))
    with pytest.raises(IntegrityError):  # 'OTHER' needs its note
        async with db_engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE payment_attempts SET status = 'REJECTED', rejection_reason = 'OTHER', "
                    "reviewed_by = gen_random_uuid(), reviewed_at = now()"
                )
            )


# ---- cancelling and refunding a paid wallet order -------------------------------------------


async def test_a_cancelled_paid_wallet_order_is_refunded_by_recording_it(
    client, admin_h, make_product, wallets_on, db_engine
):
    p, order = await wallet_order(client, make_product)
    oid = order["order_id"]
    await submit(client, oid)
    [row] = await queue(client, admin_h)
    await client.post(f"{PAYMENTS}/{row['attempt_id']}/verify", headers=admin_h)
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


async def test_an_unpaid_wallet_order_can_be_cancelled_without_a_charge(
    client, admin_h, make_product, wallets_on, db_engine
):
    p, order = await wallet_order(client, make_product, "JAZZCASH")
    oid = order["order_id"]
    await set_status(db_engine, oid, "PROCESSING")
    r = await client.post(f"{ADMIN}/{oid}/cancel", headers=admin_h, json={})
    assert r.status_code == 200 and r.json()["cancellation_charge_paisa"] == 0


async def test_the_dashboard_counts_payments_waiting_for_a_check(
    client, admin_h, make_product, wallets_on
):
    first = (await client.get("/api/admin/dashboard", headers=admin_h)).json()
    assert first["payments_to_check"] == 0
    _, order = await wallet_order(client, make_product)
    await submit(client, order["order_id"])
    assert (await client.get("/api/admin/dashboard", headers=admin_h)).json()[
        "payments_to_check"
    ] == 1
    [row] = await queue(client, admin_h)
    await client.post(f"{PAYMENTS}/{row['attempt_id']}/verify", headers=admin_h)
    assert (await client.get("/api/admin/dashboard", headers=admin_h)).json()[
        "payments_to_check"
    ] == 0
