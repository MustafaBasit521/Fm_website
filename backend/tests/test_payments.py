import asyncio
import json
import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.core.config import Settings
from app.core.payments.base import ProviderStatus
from tests.conftest import auth
from tests.test_checkout import place, stock_of
from tests.test_orders_customer import set_status

ADMIN = "/api/admin/orders"


async def online_order(client, product_id, qty=1, **kw):
    r = await place(client, [(product_id, qty)], method="ONLINE", **kw)
    assert r.status_code == 201, r.text
    return r.json()


async def pay(client, order_id):
    return await client.post(f"/api/orders/{order_id}/pay")


async def admin_order(client, admin_h, order_id):
    r = await client.get(f"{ADMIN}/{order_id}", headers=admin_h)
    assert r.status_code == 200, r.text
    return r.json()


async def webhook(client, gateway, reference, *, headers=None, body=None, name="fake"):
    signed_headers, signed_body = gateway.signed_webhook(reference)
    return await client.post(
        f"/api/payments/webhook/{name}",
        content=body if body is not None else signed_body,
        headers=headers if headers is not None else signed_headers,
    )


async def start(client, gateway, order):
    """Initiate payment and return the provider reference of the attempt."""
    r = await pay(client, order["order_id"])
    assert r.status_code == 200, r.text
    ref = next(k for k in reversed(list(gateway.attempts)))
    return ref


async def make_overdue(db_engine, order_id):
    async with db_engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE orders SET payment_deadline_at = now() - interval '5 minutes' WHERE order_id = :o"
            ),
            {"o": uuid.UUID(order_id)},
        )


# ---- configuration safety ------------------------------------------------------------------

BASE = {"database_url": "postgresql+asyncpg://x:y@h/db", "supabase_url": "https://p.supabase.co"}


def test_settings_refuse_unsafe_payment_configuration():
    with pytest.raises(ValidationError):
        Settings(**BASE, app_env="production", payment_provider="fake", _env_file=None)
    with pytest.raises(ValidationError):
        Settings(**BASE, online_payments_enabled=True, payment_provider="none", _env_file=None)
    with pytest.raises(ValidationError):
        Settings(**BASE, payment_provider="safepay", _env_file=None)
    ok = Settings(**BASE, online_payments_enabled=True, payment_provider="fake", _env_file=None)
    assert ok.payment_provider == "fake"


async def test_payment_routes_are_unavailable_without_a_provider(client, make_product):
    a = await make_product(stock_quantity=2)
    r = await place(client, [(a["product_id"], 1)])  # COD
    assert (await pay(client, r.json()["order_id"])).status_code == 503
    assert (await client.post("/api/payments/webhook/fake", content=b"{}")).status_code == 503


async def test_dev_gateway_router_is_absent_by_default(client):
    r = await client.post("/api/dev/fake-gateway/x/complete", json={"outcome": "paid"})
    assert r.status_code == 404


# ---- initiating a payment ------------------------------------------------------------------


async def test_initiate_payment_starts_an_attempt(client, online_enabled, admin_h, make_product):
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    r = await pay(client, o["order_id"])
    assert r.status_code == 200
    body = r.json()
    assert body["redirect_url"].startswith("http://front.test/dev/fake-gateway?ref=fake_")
    detail = await admin_order(client, admin_h, o["order_id"])
    assert len(detail["payments"]) == 1
    p = detail["payments"][0]
    assert (p["status"], p["method"], p["amount_paisa"]) == (
        "PENDING",
        "ONLINE",
        o["total_amount_paisa"],
    )
    assert p["provider_reference"].startswith("fake_") and p["payment_id"] == body["payment_id"]
    assert detail["status"] == "PENDING"  # nothing is confirmed until verified


async def test_cannot_start_a_second_payment_while_one_is_in_progress(
    client, online_enabled, admin_h, make_product
):
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    assert (await pay(client, o["order_id"])).status_code == 200
    r = await pay(client, o["order_id"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "PAYMENT_IN_PROGRESS"
    assert len((await admin_order(client, admin_h, o["order_id"]))["payments"]) == 1


async def test_orders_that_cannot_be_paid(client, online_enabled, admin_h, make_product, db_engine):
    a = await make_product(stock_quantity=10)
    cod = (await place(client, [(a["product_id"], 1)])).json()
    r = await pay(client, cod["order_id"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_PAYABLE"

    cancelled = await online_order(client, a["product_id"])
    await client.post(f"{ADMIN}/{cancelled['order_id']}/cancel", headers=admin_h, json={})
    assert (await pay(client, cancelled["order_id"])).json()["detail"]["code"] == "NOT_PAYABLE"

    assert (await pay(client, str(uuid.uuid4()))).status_code == 404
    assert (await client.post("/api/orders/nope/pay")).status_code == 422


async def test_cannot_pay_after_the_window_has_passed(
    client, online_enabled, make_product, db_engine
):
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    await make_overdue(db_engine, o["order_id"])
    r = await pay(client, o["order_id"])
    assert r.status_code == 409  # the order was expired first, so it is no longer payable
    assert await stock_of(db_engine, a["product_id"]) == 3


# ---- verified success ----------------------------------------------------------------------


async def test_verified_payment_confirms_the_order(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    assert (await webhook(client, gw, ref)).status_code == 200
    detail = await admin_order(client, admin_h, o["order_id"])
    assert detail["status"] == "CONFIRMED"
    assert detail["payments"][0]["status"] == "PAID"
    assert detail["payment_status"] == "PAID"
    assert await stock_of(db_engine, a["product_id"]) == 2  # still reserved


async def test_webhook_before_payment_changes_nothing(
    client, online_enabled, admin_h, make_product
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    assert (await webhook(client, gw, ref)).status_code == 200  # provider says: still pending
    detail = await admin_order(client, admin_h, o["order_id"])
    assert (detail["status"], detail["payment_status"]) == ("PENDING", "PENDING")


async def test_duplicate_and_concurrent_webhooks_are_idempotent(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    results = await asyncio.gather(*[webhook(client, gw, ref) for _ in range(6)])
    assert [r.status_code for r in results] == [200] * 6
    detail = await admin_order(client, admin_h, o["order_id"])
    assert (detail["status"], detail["payment_status"]) == ("CONFIRMED", "PAID")
    assert len(detail["payments"]) == 1
    assert await stock_of(db_engine, a["product_id"]) == 2


async def test_customer_returning_from_the_gateway_verifies_the_payment(
    client, online_enabled, make_product
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    url = f"/api/orders/{o['order_id']}/payment/refresh"
    first = await client.post(url)  # nothing paid yet
    assert first.json() == {"order_status": "PENDING", "payment_status": "PENDING"}
    gw.complete(ref, ProviderStatus.PAID)  # the webhook never arrives, but the customer returns
    second = await client.post(url)
    assert second.json() == {"order_status": "CONFIRMED", "payment_status": "PAID"}
    assert (await client.post(f"/api/orders/{uuid.uuid4()}/payment/refresh")).status_code == 404


async def test_the_browser_cannot_claim_payment_success(client, online_enabled, make_product):
    """Only the provider's answer matters: any amount of poking leaves an unpaid order unpaid."""
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    await start(client, gw, o)
    for _ in range(3):
        r = await client.post(f"/api/orders/{o['order_id']}/payment/refresh", json={"paid": True})
        assert r.json()["payment_status"] == "PENDING"
    r = await client.post("/api/dev/fake-gateway/anything/complete", json={"outcome": "paid"})
    assert r.status_code == 404  # no simulator endpoint exists in this configuration


# ---- failure and retry ---------------------------------------------------------------------


async def test_failed_attempt_does_not_cancel_the_order_and_can_be_retried(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    first = await start(client, gw, o)
    gw.complete(first, ProviderStatus.FAILED)
    await webhook(client, gw, first)
    detail = await admin_order(client, admin_h, o["order_id"])
    assert detail["status"] == "PENDING"  # business-rules §20
    assert [p["status"] for p in detail["payments"]] == ["FAILED"]
    assert await stock_of(db_engine, a["product_id"]) == 2  # reservation kept for the retry

    second = await start(client, gw, o)  # retry within the window
    assert second != first
    detail = await admin_order(client, admin_h, o["order_id"])
    assert [p["status"] for p in detail["payments"]] == ["FAILED", "PENDING"]
    assert detail["payments"][0]["provider_reference"] == first  # history is preserved

    gw.complete(second, ProviderStatus.PAID)
    await webhook(client, gw, second)
    detail = await admin_order(client, admin_h, o["order_id"])
    assert detail["status"] == "CONFIRMED"
    assert sorted(p["status"] for p in detail["payments"]) == ["FAILED", "PAID"]
    assert detail["payment_status"] == "PAID"


async def test_retry_settles_an_abandoned_attempt_first(
    client, online_enabled, admin_h, make_product
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    first = await start(client, gw, o)
    gw.complete(first, ProviderStatus.FAILED)  # failed at the gateway; no webhook received
    assert (await pay(client, o["order_id"])).status_code == 200  # verifies, then starts anew
    detail = await admin_order(client, admin_h, o["order_id"])
    assert [p["status"] for p in detail["payments"]] == ["FAILED", "PENDING"]


async def test_payment_discovered_while_retrying_confirms_instead_of_double_charging(
    client, online_enabled, admin_h, make_product
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)  # paid, but we have not been told yet
    r = await pay(client, o["order_id"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ALREADY_PAID"
    detail = await admin_order(client, admin_h, o["order_id"])
    assert (detail["status"], detail["payment_status"]) == ("CONFIRMED", "PAID")
    assert len(detail["payments"]) == 1  # no second attempt was created


async def test_an_order_with_only_failed_attempts_still_expires(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.FAILED)
    await webhook(client, gw, ref)
    await make_overdue(db_engine, o["order_id"])
    async with db_engine.begin() as conn:
        expired = (await conn.execute(text("SELECT expire_unpaid_online_orders()"))).scalar()
    assert expired == 1
    assert (await admin_order(client, admin_h, o["order_id"]))["status"] == "CANCELLED"
    assert await stock_of(db_engine, a["product_id"]) == 3


# ---- webhook security ----------------------------------------------------------------------


async def test_webhook_rejects_forged_or_malformed_requests(
    client, online_enabled, admin_h, make_product
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    headers, body = gw.signed_webhook(ref)

    assert (await webhook(client, gw, ref, headers={})).status_code == 400  # no signature
    assert (
        await webhook(client, gw, ref, headers={"x-fake-signature": "0" * 64})
    ).status_code == 400
    tampered = json.dumps({"reference": ref, "extra": 1}).encode()
    assert (await webhook(client, gw, ref, headers=headers, body=tampered)).status_code == 400
    garbage = b"not json"
    g_headers, _ = gw.signed_webhook("x")
    from app.core.payments.fake import SIGNATURE_HEADER, sign

    signed_garbage = {SIGNATURE_HEADER: sign("test-secret", garbage)}
    assert (await webhook(client, gw, ref, headers=signed_garbage, body=garbage)).status_code == 400
    assert (await webhook(client, gw, ref, name="otherpay")).status_code == 404
    detail = await admin_order(client, admin_h, o["order_id"])
    assert detail["status"] == "PENDING"  # nothing above changed anything
    assert (await webhook(client, gw, ref)).status_code == 200  # the genuine one works
    assert (await admin_order(client, admin_h, o["order_id"]))["status"] == "CONFIRMED"


async def test_webhook_for_an_unknown_reference_is_acknowledged_and_ignored(client, online_enabled):
    r = await webhook(client, online_enabled, "fake_does_not_exist")
    assert r.status_code == 200


async def test_amount_mismatch_never_confirms_an_order(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.attempts[ref]["amount_paisa"] = 1  # the provider says only 1 paisa was charged
    gw.complete(ref, ProviderStatus.PAID)
    assert (await webhook(client, gw, ref)).status_code == 200
    detail = await admin_order(client, admin_h, o["order_id"])
    assert (detail["status"], detail["payment_status"]) == ("PENDING", "PENDING")


async def test_provider_outage_makes_the_webhook_fail_so_it_is_retried(
    client, online_enabled, admin_h, make_product
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    gw.fail_verify = True
    assert (await webhook(client, gw, ref)).status_code == 503
    assert (await admin_order(client, admin_h, o["order_id"]))["status"] == "PENDING"
    gw.fail_verify = False
    assert (await webhook(client, gw, ref)).status_code == 200  # the provider's retry succeeds
    assert (await admin_order(client, admin_h, o["order_id"]))["status"] == "CONFIRMED"


# ---- late payment (decided: stays cancelled, refunded in full) ------------------------------


async def test_payment_after_expiry_is_recorded_and_refundable_in_full(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    await make_overdue(db_engine, o["order_id"])
    async with db_engine.begin() as conn:
        await conn.execute(text("SELECT expire_unpaid_online_orders()"))
    assert await stock_of(db_engine, a["product_id"]) == 3  # released by the expiry job

    gw.complete(ref, ProviderStatus.PAID)  # the customer paid just after the window closed
    assert (await webhook(client, gw, ref)).status_code == 200
    detail = await admin_order(client, admin_h, o["order_id"])
    assert detail["status"] == "CANCELLED"  # never reopened
    assert detail["payment_status"] == "PAID"
    assert detail["refund_due_paisa"] == o["total_amount_paisa"]
    assert detail["cancellation_charge_paisa"] == 0
    assert await stock_of(db_engine, a["product_id"]) == 3  # not taken twice

    r = await client.post(f"{ADMIN}/{o['order_id']}/refund", headers=admin_h, json={})
    assert r.status_code == 200
    assert (r.json()["payment_status"], r.json()["refund_due_paisa"]) == ("REFUNDED", 0)


async def test_payment_after_the_deadline_but_before_the_expiry_job(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    await make_overdue(db_engine, o["order_id"])  # the cron job has not run yet
    gw.complete(ref, ProviderStatus.PAID)
    assert (await webhook(client, gw, ref)).status_code == 200
    detail = await admin_order(client, admin_h, o["order_id"])
    assert (detail["status"], detail["payment_status"]) == ("CANCELLED", "PAID")
    assert detail["refund_due_paisa"] == o["total_amount_paisa"]
    assert await stock_of(db_engine, a["product_id"]) == 3  # released exactly once


async def test_payment_racing_with_an_admin_cancel_ends_consistently(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    hook, cancel = await asyncio.gather(
        webhook(client, gw, ref),
        client.post(f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={}),
    )
    assert (hook.status_code, cancel.status_code) == (200, 200)
    detail = await admin_order(client, admin_h, o["order_id"])
    assert (detail["status"], detail["payment_status"]) == ("CANCELLED", "PAID")
    assert detail["refund_due_paisa"] == o["total_amount_paisa"]
    assert await stock_of(db_engine, a["product_id"]) == 3  # returned exactly once


# ---- refunds -------------------------------------------------------------------------------


async def paid_cancelled_order(
    client, gw, admin_h, make_product, db_engine, *, processing=False, price=100000
):
    a = await make_product(stock_quantity=5, price_paisa=price)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    await webhook(client, gw, ref)
    if processing:
        await set_status(db_engine, o["order_id"], "PROCESSING")
    await client.post(f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={})
    return o, ref


async def test_full_refund_of_a_confirmed_order_cancellation(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    o, ref = await paid_cancelled_order(client, gw, admin_h, make_product, db_engine)
    r = await client.post(f"{ADMIN}/{o['order_id']}/refund", headers=admin_h, json={})
    body = r.json()
    assert r.status_code == 200
    assert body["payment_status"] == "REFUNDED"
    assert body["payments"][0]["refunded_amount_paisa"] == o["total_amount_paisa"]
    assert body["refund_due_paisa"] == 0
    assert gw.refunded[ref] == o["total_amount_paisa"]
    again = await client.post(f"{ADMIN}/{o['order_id']}/refund", headers=admin_h, json={})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "NOTHING_TO_REFUND"


async def test_partial_refunds_never_exceed_what_is_owed(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    o, ref = await paid_cancelled_order(
        client, gw, admin_h, make_product, db_engine, processing=True
    )
    total = o["total_amount_paisa"]
    charge = total // 2
    due = total - charge
    detail = await admin_order(client, admin_h, o["order_id"])
    assert (detail["cancellation_charge_paisa"], detail["refund_due_paisa"]) == (charge, due)

    url = f"{ADMIN}/{o['order_id']}/refund"
    first = await client.post(url, headers=admin_h, json={"amount_paisa": 1000})
    assert first.status_code == 200
    assert first.json()["payment_status"] == "PARTIALLY_REFUNDED"
    assert first.json()["refund_due_paisa"] == due - 1000
    too_much = await client.post(url, headers=admin_h, json={"amount_paisa": due})
    assert too_much.status_code == 422 and too_much.json()["detail"]["code"] == "REFUND_TOO_LARGE"
    assert (await client.post(url, headers=admin_h, json={"amount_paisa": 0})).status_code == 422
    rest = await client.post(url, headers=admin_h, json={})  # default: everything still owed
    assert rest.status_code == 200 and rest.json()["refund_due_paisa"] == 0
    # the cancellation charge is kept, so the payment stays "partially refunded"
    assert rest.json()["payment_status"] == "PARTIALLY_REFUNDED"
    assert gw.refunded[ref] == due
    assert (await client.post(url, headers=admin_h, json={})).status_code == 409


async def test_waived_charge_refunds_everything(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    a = await make_product(stock_quantity=5, price_paisa=100000)
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    await webhook(client, gw, ref)
    await set_status(db_engine, o["order_id"], "PROCESSING")
    await client.post(
        f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={"waive_charge": True}
    )
    r = await client.post(f"{ADMIN}/{o['order_id']}/refund", headers=admin_h, json={})
    assert r.json()["payment_status"] == "REFUNDED"
    assert gw.refunded[ref] == o["total_amount_paisa"]


async def test_refund_failure_changes_nothing_and_can_be_retried(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    o, ref = await paid_cancelled_order(client, gw, admin_h, make_product, db_engine)
    gw.fail_refunds = True
    r = await client.post(f"{ADMIN}/{o['order_id']}/refund", headers=admin_h, json={})
    assert r.status_code == 502 and r.json()["detail"]["code"] == "REFUND_FAILED"
    detail = await admin_order(client, admin_h, o["order_id"])
    assert (detail["payment_status"], detail["refund_due_paisa"]) == (
        "PAID",
        o["total_amount_paisa"],
    )
    gw.fail_refunds = False
    assert (
        await client.post(f"{ADMIN}/{o['order_id']}/refund", headers=admin_h, json={})
    ).status_code == 200


async def test_simultaneous_refund_requests_refund_only_once(
    client, online_enabled, admin_h, make_product, db_engine
):
    gw = online_enabled
    o, ref = await paid_cancelled_order(client, gw, admin_h, make_product, db_engine)
    results = await asyncio.gather(
        *[
            client.post(f"{ADMIN}/{o['order_id']}/refund", headers=admin_h, json={})
            for _ in range(4)
        ]
    )
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409]
    assert gw.refunded[ref] == o["total_amount_paisa"]  # never more than was paid


async def test_refund_preconditions(client, online_enabled, admin_h, make_product, db_engine):
    gw = online_enabled
    a = await make_product(stock_quantity=10)
    # not cancelled
    o = await online_order(client, a["product_id"])
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    await webhook(client, gw, ref)
    r = await client.post(f"{ADMIN}/{o['order_id']}/refund", headers=admin_h, json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_CANCELLED"
    # cancelled but never paid
    unpaid = await online_order(client, a["product_id"])
    await client.post(f"{ADMIN}/{unpaid['order_id']}/cancel", headers=admin_h, json={})
    r = await client.post(f"{ADMIN}/{unpaid['order_id']}/refund", headers=admin_h, json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOTHING_TO_REFUND"
    # cash on delivery: nothing was collected online
    cod = (await place(client, [(a["product_id"], 1)])).json()
    await client.post(f"{ADMIN}/{cod['order_id']}/cancel", headers=admin_h, json={})
    r = await client.post(f"{ADMIN}/{cod['order_id']}/refund", headers=admin_h, json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOTHING_TO_REFUND"
    assert (
        await client.post(f"{ADMIN}/{uuid.uuid4()}/refund", headers=admin_h, json={})
    ).status_code == 404


# ---- cash on delivery ----------------------------------------------------------------------


async def test_cod_payment_is_confirmed_by_the_admin_after_delivery(
    client, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=5)
    o = (await place(client, [(a["product_id"], 1)])).json()
    url = f"{ADMIN}/{o['order_id']}/confirm-cod-payment"
    early = await client.post(url, headers=admin_h)
    assert early.status_code == 409 and early.json()["detail"]["code"] == "NOT_DELIVERED"
    await set_status(db_engine, o["order_id"], "DELIVERED")
    done = await client.post(url, headers=admin_h)
    assert done.status_code == 200
    assert done.json()["payment_status"] == "PAID"
    assert done.json()["payments"][0]["status"] == "PAID"
    again = await client.post(url, headers=admin_h)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "ALREADY_PAID"


async def test_online_orders_cannot_be_confirmed_as_cod(
    client, online_enabled, admin_h, make_product
):
    a = await make_product(stock_quantity=5)
    o = await online_order(client, a["product_id"])
    r = await client.post(f"{ADMIN}/{o['order_id']}/confirm-cod-payment", headers=admin_h)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_COD"


async def test_payment_admin_routes_need_the_admin_role(client, online_enabled, customer_h):
    for path in ("confirm-cod-payment", "refund"):
        url = f"{ADMIN}/{uuid.uuid4()}/{path}"
        assert (await client.post(url, json={})).status_code == 401
        assert (await client.post(url, headers=customer_h, json={})).status_code == 403


async def test_registered_customers_can_pay_their_own_online_order(
    client, online_enabled, make_product, make_token
):
    gw = online_enabled
    a = await make_product(stock_quantity=3)
    h = auth(make_token(sub=uuid.uuid4(), email="reg@example.com", name="Reg"))
    r = await place(client, [(a["product_id"], 1)], method="ONLINE", headers=h)
    o = r.json()
    ref = await start(client, gw, o)
    gw.complete(ref, ProviderStatus.PAID)
    await webhook(client, gw, ref)
    mine = (await client.get(f"/api/orders/{o['order_id']}", headers=h)).json()
    assert (mine["status"], mine["payment_status"]) == ("CONFIRMED", "PAID")
