import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth
from tests.test_checkout import LAHORE, place, stock_of
from tests.test_orders_customer import set_status

ADMIN = "/api/admin/orders"


async def guest_order(client, product_id, qty=1, **kw):
    r = await place(client, [(product_id, qty)], **kw)
    assert r.status_code == 201, r.text
    return r.json()


async def pay(db_engine, order_id: str):
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE payments SET status = 'PAID' WHERE order_id = :o"),
            {"o": uuid.UUID(order_id)},
        )


async def post_status(client, admin_h, order_id, status):
    return await client.post(f"{ADMIN}/{order_id}/status", headers=admin_h, json={"status": status})


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", ADMIN),
        ("GET", f"{ADMIN}/{uuid.uuid4()}"),
        ("POST", f"{ADMIN}/{uuid.uuid4()}/status"),
        ("POST", f"{ADMIN}/{uuid.uuid4()}/cancel"),
        ("PATCH", f"{ADMIN}/{uuid.uuid4()}/address"),
    ],
)
async def test_admin_order_routes_reject_anonymous_and_customers(client, customer_h, method, url):
    assert (await client.request(method, url, json={})).status_code == 401
    assert (await client.request(method, url, headers=customer_h, json={})).status_code == 403


# ---- listing -------------------------------------------------------------------------------


async def test_admin_list_filters_search_and_pagination(
    client, online_enabled, admin_h, make_product
):
    a = await make_product(stock_quantity=50, price_paisa=100)
    pid = a["product_id"]
    cod = await guest_order(client, pid)
    await guest_order(client, pid, method="ONLINE")
    other = await place(
        client,
        [(pid, 1)],
        contact={"name": "Zainab Ali", "email": "zainab@example.com", "phone": None},
    )
    assert other.status_code == 201

    everything = (await client.get(ADMIN, headers=admin_h)).json()
    assert everything["total"] == 3 and everything["items"][0]["customer_name"]

    def ids(r):
        return [o["order_id"] for o in r.json()["items"]]

    online = await client.get(ADMIN, headers=admin_h, params={"payment_method": "ONLINE"})
    assert online.json()["total"] == 1
    assert (await client.get(ADMIN, headers=admin_h, params={"status": "CONFIRMED"})).json()[
        "total"
    ] == 0
    assert (await client.get(ADMIN, headers=admin_h, params={"status": "PENDING"})).json()[
        "total"
    ] == 3
    assert len(ids(await client.get(ADMIN, headers=admin_h, params={"search": "zainab"}))) == 1
    assert ids(await client.get(ADMIN, headers=admin_h, params={"search": cod["order_id"]})) == [
        cod["order_id"]
    ]
    assert (await client.get(ADMIN, headers=admin_h, params={"search": "%"})).json()["total"] == 0
    p2 = await client.get(ADMIN, headers=admin_h, params={"page": 2, "page_size": 2})
    assert len(p2.json()["items"]) == 1
    assert (await client.get(ADMIN, headers=admin_h, params={"status": "BOGUS"})).status_code == 422


async def test_admin_detail_includes_guest_orders_and_customer_link(
    client, admin_h, make_product, make_token
):
    a = await make_product(stock_quantity=5)
    g = await guest_order(client, a["product_id"])
    detail = (await client.get(f"{ADMIN}/{g['order_id']}", headers=admin_h)).json()
    assert detail["customer_id"] is None and detail["items"][0]["quantity"] == 1
    uid = uuid.uuid4()
    reg = await place(client, [(a["product_id"], 1)], headers=auth(make_token(sub=uid)))
    detail = (await client.get(f"{ADMIN}/{reg.json()['order_id']}", headers=admin_h)).json()
    assert detail["customer_id"] == str(uid)
    assert (await client.get(f"{ADMIN}/{uuid.uuid4()}", headers=admin_h)).status_code == 404


# ---- status transitions --------------------------------------------------------------------


async def test_normal_lifecycle_moves_one_step_at_a_time(client, admin_h, make_product):
    a = await make_product(stock_quantity=5)
    o = await guest_order(client, a["product_id"])
    for target in ("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"):
        r = await post_status(client, admin_h, o["order_id"], target)
        assert r.status_code == 200, (target, r.text)
        assert r.json()["status"] == target


async def test_invalid_transitions_are_refused(client, admin_h, make_product):
    a = await make_product(stock_quantity=5)
    o = await guest_order(client, a["product_id"])
    oid = o["order_id"]
    for bad in ("PROCESSING", "SHIPPED", "DELIVERED", "PENDING"):  # skipping / staying
        r = await post_status(client, admin_h, oid, bad)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "INVALID_TRANSITION", bad
    r = await post_status(client, admin_h, oid, "CANCELLED")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "USE_CANCEL"
    await post_status(client, admin_h, oid, "CONFIRMED")
    back = await post_status(client, admin_h, oid, "PENDING")  # no going backwards
    assert back.status_code == 409
    assert (await post_status(client, admin_h, oid, "NOPE")).status_code == 422
    assert (await post_status(client, admin_h, str(uuid.uuid4()), "CONFIRMED")).status_code == 404


async def test_terminal_states_cannot_move(client, admin_h, make_product, db_engine):
    a = await make_product(stock_quantity=5)
    for state in ("DELIVERED", "CANCELLED"):
        o = await guest_order(client, a["product_id"])
        await set_status(db_engine, o["order_id"], state)
        for target in ("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"):
            assert (await post_status(client, admin_h, o["order_id"], target)).status_code == 409


async def test_online_order_cannot_be_confirmed_before_payment_is_verified(
    client, online_enabled, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=5)
    o = await guest_order(client, a["product_id"], method="ONLINE")
    r = await post_status(client, admin_h, o["order_id"], "CONFIRMED")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "PAYMENT_NOT_VERIFIED"
    await pay(db_engine, o["order_id"])  # as the payment phase will do after verification
    assert (await post_status(client, admin_h, o["order_id"], "CONFIRMED")).status_code == 200


# ---- admin cancellation and the Processing charge ------------------------------------------


async def test_admin_cancel_pending_has_no_charge_and_returns_stock(
    client, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=5)
    o = await guest_order(client, a["product_id"], 2)
    r = await client.post(f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "CANCELLED"
    assert (body["cancellation_charge_paisa"], body["charge_waived"]) == (0, False)
    assert await stock_of(db_engine, a["product_id"]) == 5


async def test_processing_cod_cancellation_waives_the_charge(
    client, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=5, price_paisa=100000)
    o = await guest_order(client, a["product_id"])
    await set_status(db_engine, o["order_id"], "PROCESSING")
    body = (await client.post(f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={})).json()
    # COD not yet collected: charge waived, nothing to refund (business-rules §18)
    assert (body["cancellation_charge_paisa"], body["charge_waived"], body["refund_due_paisa"]) == (
        0,
        True,
        0,
    )
    assert await stock_of(db_engine, a["product_id"]) == 5


async def test_processing_online_cancellation_charges_half_rounded_down(
    client, online_enabled, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=5, price_paisa=100)
    async with db_engine.begin() as conn:  # make the total odd: 100 + 20001 = 20101
        await conn.execute(text("UPDATE business_settings SET delivery_fee_paisa = 20001"))
    o = await guest_order(client, a["product_id"], method="ONLINE")
    assert o["total_amount_paisa"] == 20101
    await pay(db_engine, o["order_id"])
    await set_status(db_engine, o["order_id"], "PROCESSING")
    body = (await client.post(f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={})).json()
    assert body["cancellation_charge_paisa"] == 10050  # 20101 // 2, rounded down
    assert body["charge_waived"] is False
    assert body["refund_due_paisa"] == 20101 - 10050  # amount paid - charge
    assert await stock_of(db_engine, a["product_id"]) == 5


async def test_admin_can_waive_the_processing_charge(
    client, online_enabled, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=5, price_paisa=100000)
    o = await guest_order(client, a["product_id"], method="ONLINE")
    await pay(db_engine, o["order_id"])
    await set_status(db_engine, o["order_id"], "PROCESSING")
    r = await client.post(
        f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={"waive_charge": True}
    )
    body = r.json()
    assert (body["cancellation_charge_paisa"], body["charge_waived"]) == (0, True)
    assert body["refund_due_paisa"] == o["total_amount_paisa"]  # full amount paid


async def test_confirmed_paid_online_cancellation_refunds_everything(
    client, online_enabled, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=5)
    o = await guest_order(client, a["product_id"], method="ONLINE")
    await pay(db_engine, o["order_id"])
    await set_status(db_engine, o["order_id"], "CONFIRMED")
    body = (await client.post(f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={})).json()
    assert body["cancellation_charge_paisa"] == 0
    assert body["refund_due_paisa"] == o["total_amount_paisa"]


async def test_unpaid_cancelled_order_owes_nothing(client, online_enabled, admin_h, make_product):
    a = await make_product(stock_quantity=5)
    o = await guest_order(client, a["product_id"], method="ONLINE")
    body = (await client.post(f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={})).json()
    assert body["refund_due_paisa"] == 0


@pytest.mark.parametrize("state", ["SHIPPED", "DELIVERED", "CANCELLED"])
async def test_admin_cannot_cancel_shipped_delivered_or_cancelled(
    client, admin_h, make_product, db_engine, state
):
    a = await make_product(stock_quantity=5)
    o = await guest_order(client, a["product_id"])
    await set_status(db_engine, o["order_id"], state)
    r = await client.post(f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CANNOT_CANCEL"
    assert await stock_of(db_engine, a["product_id"]) == 4


async def test_cancel_unknown_order_and_extra_fields(client, admin_h):
    assert (
        await client.post(f"{ADMIN}/{uuid.uuid4()}/cancel", headers=admin_h, json={})
    ).status_code == 404
    r = await client.post(f"{ADMIN}/{uuid.uuid4()}/cancel", headers=admin_h, json={"charge": 5})
    assert r.status_code == 422


async def test_cancelled_order_stock_and_snapshots_survive_product_deletion(
    client, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=5)
    o = await guest_order(client, a["product_id"])
    await client.delete(f"/api/admin/products/{a['product_id']}", headers=admin_h)
    # the product is gone (item product_id is NULL): cancelling must still work, nothing to restock
    r = await client.post(f"{ADMIN}/{o['order_id']}/cancel", headers=admin_h, json={})
    assert r.status_code == 200
    assert r.json()["items"][0]["product_name_snapshot"] == "Sunflower"


# ---- admin address change (guests who contacted the shop) ----------------------------------


async def test_admin_changes_a_guest_address_under_the_same_rules(
    client, admin_h, make_product, db_engine
):
    a = await make_product(stock_quantity=5)
    o = await guest_order(client, a["product_id"])
    url = f"{ADMIN}/{o['order_id']}/address"
    new = LAHORE | {"house_no": "55"}
    ok = await client.patch(url, headers=admin_h, json={"address": new})
    assert ok.status_code == 200 and ok.json()["delivery_house_no"] == "55"
    karachi = await client.patch(url, headers=admin_h, json={"address": new | {"city": "Karachi"}})
    assert karachi.status_code == 422
    saved_id = await client.patch(url, headers=admin_h, json={"address_id": str(uuid.uuid4())})
    assert saved_id.status_code == 422  # saved addresses belong to customers
    await set_status(db_engine, o["order_id"], "SHIPPED")
    locked = await client.patch(url, headers=admin_h, json={"address": new})
    assert locked.status_code == 409 and locked.json()["detail"]["code"] == "ADDRESS_LOCKED"
