import asyncio
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth
from tests.test_checkout import LAHORE, place, stock_of

URL = "/api/orders"


@pytest.fixture
def alice(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="alice@example.com", name="Alice"))


@pytest.fixture
def bob(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="bob@example.com", name="Bob"))


async def set_status(db_engine, order_id: str, status: str):
    async with db_engine.begin() as conn:
        await conn.execute(
            text("UPDATE orders SET status = :s WHERE order_id = :o"),
            {"s": status, "o": uuid.UUID(order_id)},
        )


async def my_order(client, headers, product_id, qty=1):
    r = await place(client, [(product_id, qty)], headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", URL),
        ("GET", f"{URL}/{uuid.uuid4()}"),
        ("POST", f"{URL}/{uuid.uuid4()}/cancel"),
        ("PATCH", f"{URL}/{uuid.uuid4()}/address"),
    ],
)
async def test_order_history_requires_login(client, method, url):
    assert (await client.request(method, url, json={})).status_code == 401


# ---- history -------------------------------------------------------------------------------


async def test_history_lists_only_my_orders_newest_first(client, make_product, alice, bob):
    a = await make_product(name="A", stock_quantity=20, price_paisa=100)
    first = await my_order(client, alice, a["product_id"], 2)
    second = await my_order(client, alice, a["product_id"], 1)
    await my_order(client, bob, a["product_id"])
    assert (await place(client, [(a["product_id"], 1)])).status_code == 201  # guest order

    page = (await client.get(URL, headers=alice)).json()
    assert page["total"] == 2
    assert [o["order_id"] for o in page["items"]] == [second["order_id"], first["order_id"]]
    assert page["items"][1]["item_count"] == 2
    assert page["items"][0]["status"] == "PENDING"
    assert page["items"][0]["payment_method"] == "COD"

    p2 = (await client.get(URL, headers=alice, params={"page": 2, "page_size": 1})).json()
    assert [o["order_id"] for o in p2["items"]] == [first["order_id"]]
    assert (await client.get(URL, headers=alice, params={"page_size": 51})).status_code == 422


async def test_order_detail_is_private(client, make_product, alice, bob):
    a = await make_product(name="Sunflower", stock_quantity=5, price_paisa=1000)
    o = await my_order(client, alice, a["product_id"])
    mine = (await client.get(f"{URL}/{o['order_id']}", headers=alice)).json()
    assert mine["items"][0]["product_name_snapshot"] == "Sunflower"
    assert mine["delivery_city"] == "Lahore"
    # another customer, an unknown id and a malformed id all look the same / are rejected
    assert (await client.get(f"{URL}/{o['order_id']}", headers=bob)).status_code == 404
    assert (await client.get(f"{URL}/{uuid.uuid4()}", headers=alice)).status_code == 404
    assert (await client.get(f"{URL}/nope", headers=alice)).status_code == 422


async def test_guest_orders_cannot_be_reached_by_any_customer(client, make_product, alice):
    a = await make_product(stock_quantity=5)
    guest = (await place(client, [(a["product_id"], 1)])).json()
    assert (await client.get(f"{URL}/{guest['order_id']}", headers=alice)).status_code == 404
    assert (
        await client.post(f"{URL}/{guest['order_id']}/cancel", headers=alice)
    ).status_code == 404


# ---- cancellation --------------------------------------------------------------------------


async def test_customer_can_cancel_pending_order_and_stock_returns(
    client, make_product, alice, db_engine
):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"], 2)
    assert await stock_of(db_engine, a["product_id"]) == 3
    r = await client.post(f"{URL}/{o['order_id']}/cancel", headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "CANCELLED" and body["cancelled_at"] is not None
    assert body["cancellation_charge_paisa"] == 0 and body["charge_waived"] is False
    assert await stock_of(db_engine, a["product_id"]) == 5  # released
    # cancelling again is refused and never returns stock twice
    again = await client.post(f"{URL}/{o['order_id']}/cancel", headers=alice)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "CANNOT_CANCEL"
    assert await stock_of(db_engine, a["product_id"]) == 5


async def test_customer_can_cancel_confirmed_order(client, make_product, alice, db_engine):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    await set_status(db_engine, o["order_id"], "CONFIRMED")
    assert (await client.post(f"{URL}/{o['order_id']}/cancel", headers=alice)).status_code == 200
    assert await stock_of(db_engine, a["product_id"]) == 5


async def test_processing_requires_contacting_the_shop(client, make_product, alice, db_engine):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    await set_status(db_engine, o["order_id"], "PROCESSING")
    r = await client.post(f"{URL}/{o['order_id']}/cancel", headers=alice)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CONTACT_SHOP"
    assert await stock_of(db_engine, a["product_id"]) == 4  # untouched
    assert (await client.get(f"{URL}/{o['order_id']}", headers=alice)).json()[
        "status"
    ] == "PROCESSING"


@pytest.mark.parametrize("state", ["SHIPPED", "DELIVERED", "CANCELLED"])
async def test_shipped_delivered_and_cancelled_cannot_be_cancelled(
    client, make_product, alice, db_engine, state
):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    await set_status(db_engine, o["order_id"], state)
    r = await client.post(f"{URL}/{o['order_id']}/cancel", headers=alice)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CANNOT_CANCEL"
    assert await stock_of(db_engine, a["product_id"]) == 4


async def test_cannot_cancel_someone_elses_order(client, make_product, alice, bob, db_engine):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    assert (await client.post(f"{URL}/{o['order_id']}/cancel", headers=bob)).status_code == 404
    assert (await client.get(f"{URL}/{o['order_id']}", headers=alice)).json()["status"] == "PENDING"
    assert await stock_of(db_engine, a["product_id"]) == 4


async def test_cancelling_frees_made_to_order_capacity(client, make_product, alice):
    m = await make_product(availability_type="MADE_TO_ORDER", stock_quantity=0, max_active_units=1)
    o = await my_order(client, alice, m["product_id"])
    assert (await place(client, [(m["product_id"], 1)])).status_code == 409
    await client.post(f"{URL}/{o['order_id']}/cancel", headers=alice)
    assert (await place(client, [(m["product_id"], 1)])).status_code == 201


async def test_concurrent_cancels_return_stock_exactly_once(client, make_product, alice, db_engine):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"], 2)
    results = await asyncio.gather(
        *[client.post(f"{URL}/{o['order_id']}/cancel", headers=alice) for _ in range(6)]
    )
    assert sorted(r.status_code for r in results) == [200] + [409] * 5
    assert await stock_of(db_engine, a["product_id"]) == 5  # not 5 + 2*5


async def test_cancel_racing_with_admin_status_change_is_consistent(
    client, make_product, alice, admin_h, db_engine
):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    await set_status(db_engine, o["order_id"], "CONFIRMED")
    cancel = client.post(f"{URL}/{o['order_id']}/cancel", headers=alice)
    advance = client.post(
        f"/api/admin/orders/{o['order_id']}/status", headers=admin_h, json={"status": "PROCESSING"}
    )
    r_cancel, r_advance = await asyncio.gather(cancel, advance)
    final = (await client.get(f"{URL}/{o['order_id']}", headers=alice)).json()["status"]
    if r_cancel.status_code == 200:  # cancel won: the status change must have been refused
        assert (final, r_advance.status_code) == ("CANCELLED", 409)
        assert await stock_of(db_engine, a["product_id"]) == 5
    else:  # status change won: Processing needs the shop, so the customer cancel is refused
        assert (final, r_cancel.status_code) == ("PROCESSING", 409)
        assert await stock_of(db_engine, a["product_id"]) == 4


# ---- address change ------------------------------------------------------------------------


async def test_change_address_while_pending(client, make_product, alice):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    new = LAHORE | {"house_no": "99", "city": " lahore ", "postal_code": "54700"}
    r = await client.patch(f"{URL}/{o['order_id']}/address", headers=alice, json={"address": new})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["delivery_house_no"], body["delivery_postal_code"]) == ("99", "54700")
    assert body["delivery_city"] == "Lahore"
    assert body["delivery_name"] == "Ayesha Khan"  # unchanged when no recipient is given
    r = await client.patch(
        f"{URL}/{o['order_id']}/address",
        headers=alice,
        json={"recipient_name": "Her Sister", "address": new},
    )
    assert r.json()["delivery_name"] == "Her Sister"


async def test_change_address_to_a_saved_address(client, make_product, alice, bob):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    mine = (
        await client.post(
            "/api/customers/me/addresses", headers=alice, json=LAHORE | {"house_no": "7-C"}
        )
    ).json()
    theirs = (await client.post("/api/customers/me/addresses", headers=bob, json=LAHORE)).json()
    ok = await client.patch(
        f"{URL}/{o['order_id']}/address", headers=alice, json={"address_id": mine["address_id"]}
    )
    assert ok.status_code == 200 and ok.json()["delivery_house_no"] == "7-C"
    other = await client.patch(
        f"{URL}/{o['order_id']}/address", headers=alice, json={"address_id": theirs["address_id"]}
    )
    assert other.status_code == 404  # someone else's saved address


async def test_address_change_rules(client, make_product, alice, db_engine):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    url = f"{URL}/{o['order_id']}/address"
    karachi = await client.patch(url, headers=alice, json={"address": LAHORE | {"city": "Karachi"}})
    assert karachi.status_code == 422 and karachi.json()["detail"]["code"] == "NOT_DELIVERABLE"
    for body in ({}, {"address": LAHORE, "address_id": str(uuid.uuid4())}):
        assert (await client.patch(url, headers=alice, json=body)).status_code == 422
    await set_status(db_engine, o["order_id"], "CONFIRMED")
    assert (await client.patch(url, headers=alice, json={"address": LAHORE})).status_code == 200
    for state in ("PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"):
        await set_status(db_engine, o["order_id"], state)
        r = await client.patch(url, headers=alice, json={"address": LAHORE | {"house_no": "1"}})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "ADDRESS_LOCKED", state


async def test_cannot_change_someone_elses_order_address(client, make_product, alice, bob):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    r = await client.patch(f"{URL}/{o['order_id']}/address", headers=bob, json={"address": LAHORE})
    assert r.status_code == 404


async def test_items_and_quantities_cannot_be_changed(client, make_product, alice):
    a = await make_product(stock_quantity=5)
    o = await my_order(client, alice, a["product_id"])
    for method, url in (("PATCH", f"{URL}/{o['order_id']}"), ("PUT", f"{URL}/{o['order_id']}")):
        assert (
            await client.request(method, url, headers=alice, json={"items": []})
        ).status_code == 405
    # extra fields on the address endpoint are rejected too
    r = await client.patch(
        f"{URL}/{o['order_id']}/address", headers=alice, json={"address": LAHORE, "items": []}
    )
    assert r.status_code == 422
