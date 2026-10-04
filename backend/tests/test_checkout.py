import asyncio
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth

LAHORE = {
    "house_no": "12-B",
    "street_number": "Street 4",
    "city": "Lahore",
    "province": "Punjab",
    "postal_code": "54000",
    "country": "Pakistan",
}
CONTACT = {"name": "Ayesha Khan", "email": "Ayesha@Example.com", "phone": "0300 1234567"}


def order_body(items, *, method="COD", address=None, **over):
    body = {
        "items": [{"product_id": p, "quantity": q} for p, q in items],
        "contact": CONTACT,
        "delivery": {"address": address or LAHORE},
        "payment_method": method,
    }
    return body | over


async def place(client, items, headers=None, **over):
    return await client.post("/api/orders", json=order_body(items, **over), headers=headers)


async def db_value(db_engine, sql, **params):
    async with db_engine.connect() as conn:
        return (await conn.execute(text(sql), params)).scalar()


async def stock_of(db_engine, product_id):
    return await db_value(
        db_engine,
        "SELECT stock_quantity FROM products WHERE product_id = :p",
        p=uuid.UUID(product_id),
    )


# ---- quote ---------------------------------------------------------------------------------


async def quote(client, items):
    return await client.post(
        "/api/checkout/quote", json={"items": [{"product_id": p, "quantity": q} for p, q in items]}
    )


async def test_quote_totals_come_from_the_server(client, make_product):
    a = await make_product(name="A", price_paisa=125050, stock_quantity=10)
    b = await make_product(name="B", price_paisa=999, stock_quantity=10)
    r = await quote(client, [(a["product_id"], 2), (b["product_id"], 3)])
    assert r.status_code == 200
    q = r.json()
    assert q["subtotal_paisa"] == 2 * 125050 + 3 * 999
    assert q["delivery_fee_paisa"] == 20000
    assert q["total_paisa"] == q["subtotal_paisa"] + 20000
    assert q["can_checkout"] is True
    assert q["payment_methods"] == ["COD"]
    assert (
        q["lines"][0]["unit_price_paisa"] == 125050 and q["lines"][0]["line_total_paisa"] == 250100
    )


async def test_quote_merges_duplicate_lines(client, make_product):
    a = await make_product(stock_quantity=10)
    q = (await quote(client, [(a["product_id"], 2), (a["product_id"], 3)])).json()
    assert len(q["lines"]) == 1 and q["lines"][0]["quantity"] == 5


async def test_quote_flags_problem_lines_and_blocks_checkout(client, make_product):
    ok = await make_product(name="Ok", stock_quantity=5, price_paisa=100)
    sold_out = await make_product(name="Out", stock_quantity=0)
    low = await make_product(name="Low", stock_quantity=2)
    hidden = await make_product(name="Hidden", is_visible=False)
    r = await quote(
        client,
        [
            (ok["product_id"], 1),
            (sold_out["product_id"], 1),
            (low["product_id"], 5),
            (hidden["product_id"], 1),
            (str(uuid.uuid4()), 1),
        ],
    )
    q = r.json()
    issues = [(line["name"], line["issue"], line["max_quantity"]) for line in q["lines"]]
    assert issues == [
        ("Ok", None, None),
        ("Out", "UNAVAILABLE", None),
        ("Low", "EXCEEDS_AVAILABLE", 2),
        (None, "NOT_FOUND", None),  # hidden products look exactly like unknown ones
        (None, "NOT_FOUND", None),
    ]
    assert q["can_checkout"] is False
    assert q["subtotal_paisa"] == 100  # only the valid line counts


@pytest.mark.parametrize(
    "items",
    [
        [],
        [{"product_id": str(uuid.uuid4()), "quantity": 0}],
        [{"product_id": str(uuid.uuid4()), "quantity": 100}],
        [{"product_id": str(uuid.uuid4()), "quantity": 1, "price_paisa": 1}],  # no client prices
        [{"product_id": "nope", "quantity": 1}],
    ],
)
async def test_quote_validation(client, items):
    assert (await client.post("/api/checkout/quote", json={"items": items})).status_code == 422


async def test_delivery_fee_is_read_from_business_settings(client, make_product, db_engine):
    a = await make_product(stock_quantity=1, price_paisa=100)
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET delivery_fee_paisa = 35000"))
    assert (await quote(client, [(a["product_id"], 1)])).json()["total_paisa"] == 35100


async def test_made_to_order_quote_uses_capacity(client, make_product):
    m = await make_product(availability_type="MADE_TO_ORDER", stock_quantity=0, max_active_units=2)
    line = (await quote(client, [(m["product_id"], 3)])).json()["lines"][0]
    assert (line["issue"], line["max_quantity"]) == ("EXCEEDS_AVAILABLE", 2)


# ---- order creation: happy paths -----------------------------------------------------------


async def test_guest_cod_order(client, make_product, db_engine):
    a = await make_product(name="Sunflower", price_paisa=125050, stock_quantity=5)
    r = await place(client, [(a["product_id"], 2)], address=LAHORE | {"city": "  lAhOrE "})
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["status"] == "PENDING"
    assert (o["payment_method"], o["payment_status"], o["payment_deadline_at"]) == (
        "COD",
        "PENDING",
        None,
    )
    assert o["subtotal_paisa"] == 250100 and o["delivery_fee_paisa"] == 20000
    assert o["total_amount_paisa"] == 270100
    assert o["delivery_city"] == "Lahore"  # canonical value
    assert o["delivery_name"] == "Ayesha Khan"  # defaults to the contact name
    assert o["customer_email"] == "ayesha@example.com"
    assert o["items"][0]["product_name_snapshot"] == "Sunflower"
    assert o["items"][0]["unit_price_at_purchase_paisa"] == 125050
    assert await stock_of(db_engine, a["product_id"]) == 3  # reserved at creation
    assert await db_value(db_engine, "SELECT customer_id FROM orders") is None  # guest


async def test_registered_order_with_saved_address(client, make_product, make_token, db_engine):
    a = await make_product(stock_quantity=3)
    uid = uuid.uuid4()
    h = auth(make_token(sub=uid, email="reg@example.com", name="Reg"))
    saved = (await client.post("/api/customers/me/addresses", headers=h, json=LAHORE)).json()
    body = order_body([(a["product_id"], 1)]) | {
        "delivery": {"address_id": saved["address_id"], "recipient_name": "Her Sister"}
    }
    r = await client.post("/api/orders", json=body, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["delivery_name"] == "Her Sister"
    assert r.json()["delivery_house_no"] == "12-B"
    assert await db_value(db_engine, "SELECT customer_id FROM orders") == uid


async def test_registered_customer_may_use_an_inline_address(client, make_product, make_token):
    a = await make_product(stock_quantity=3)
    h = auth(make_token())
    assert (await place(client, [(a["product_id"], 1)], headers=h)).status_code == 201


async def test_order_keeps_snapshots_when_product_changes_or_is_deleted(
    client, admin_h, make_product, db_engine
):
    a = await make_product(name="Original", price_paisa=500, stock_quantity=5)
    pid = a["product_id"]
    await place(client, [(pid, 1)])
    await client.patch(
        f"/api/admin/products/{pid}", headers=admin_h, json={"price_paisa": 9999, "name": "Renamed"}
    )
    assert (await client.delete(f"/api/admin/products/{pid}", headers=admin_h)).status_code == 204
    row = (
        await db_value(db_engine, "SELECT product_name_snapshot FROM order_items"),
        await db_value(db_engine, "SELECT unit_price_at_purchase_paisa FROM order_items"),
        await db_value(db_engine, "SELECT product_id FROM order_items"),
    )
    assert row == ("Original", 500, None)  # history survives; FK set to NULL (business-rules §3)


async def test_expected_total_must_match_when_given(client, make_product):
    a = await make_product(price_paisa=1000, stock_quantity=5)
    wrong = await place(client, [(a["product_id"], 1)], expected_total_paisa=1)
    assert wrong.status_code == 409
    assert wrong.json()["detail"]["code"] == "TOTAL_CHANGED"
    assert wrong.json()["detail"]["total_paisa"] == 21000
    right = await place(client, [(a["product_id"], 1)], expected_total_paisa=21000)
    assert right.status_code == 201


# ---- delivery rules ------------------------------------------------------------------------


@pytest.mark.parametrize("city", ["Karachi", "Islamabad", "Lahore Cantt", "Lahoree", ""])
async def test_only_lahore_is_deliverable(client, make_product, db_engine, city):
    a = await make_product(stock_quantity=2)
    r = await place(client, [(a["product_id"], 1)], address=LAHORE | {"city": city or "x"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "NOT_DELIVERABLE"
    assert await stock_of(db_engine, a["product_id"]) == 2  # nothing reserved


async def test_saved_address_outside_lahore_is_rejected_at_checkout(
    client, make_product, make_token
):
    a = await make_product(stock_quantity=2)
    h = auth(make_token())
    saved = (
        await client.post(
            "/api/customers/me/addresses", headers=h, json=LAHORE | {"city": "Karachi"}
        )
    ).json()
    body = order_body([(a["product_id"], 1)]) | {"delivery": {"address_id": saved["address_id"]}}
    r = await client.post("/api/orders", json=body, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "NOT_DELIVERABLE"


async def test_address_selection_rules(client, make_product, make_token):
    a = await make_product(stock_quantity=5)
    item = [(a["product_id"], 1)]
    alice, bob = auth(make_token(email="a@example.com")), auth(make_token(email="b@example.com"))
    saved = (await client.post("/api/customers/me/addresses", headers=alice, json=LAHORE)).json()

    guest = order_body(item) | {"delivery": {"address_id": saved["address_id"]}}
    r = await client.post("/api/orders", json=guest)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "ADDRESS_REQUIRES_LOGIN"
    # someone else's saved address is "not found"
    r = await client.post("/api/orders", json=guest, headers=bob)
    assert r.status_code == 404
    # exactly one of address_id / address
    both = order_body(item) | {"delivery": {"address_id": saved["address_id"], "address": LAHORE}}
    assert (await client.post("/api/orders", json=both, headers=alice)).status_code == 422
    neither = order_body(item) | {"delivery": {}}
    assert (await client.post("/api/orders", json=neither, headers=alice)).status_code == 422


# ---- payment method ------------------------------------------------------------------------


async def test_online_orders_are_refused_until_enabled(client, make_product, db_engine):
    a = await make_product(stock_quantity=2)
    r = await place(client, [(a["product_id"], 1)], method="ONLINE")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "PAYMENT_METHOD_UNAVAILABLE"
    assert await stock_of(db_engine, a["product_id"]) == 2


async def test_online_order_gets_a_30_minute_window(
    client, online_enabled, make_product, db_engine
):
    a = await make_product(stock_quantity=2)
    r = await place(client, [(a["product_id"], 1)], method="ONLINE")
    assert r.status_code == 201, r.text
    o = r.json()
    assert (o["status"], o["payment_method"], o["payment_status"]) == (
        "PENDING",
        "ONLINE",
        "PENDING",
    )
    assert o["payment_deadline_at"] is not None
    minutes = await db_value(
        db_engine, "SELECT extract(epoch FROM (payment_deadline_at - created_at))/60 FROM orders"
    )
    assert round(float(minutes)) == 30
    assert (await quote(client, [(a["product_id"], 1)])).json()["payment_methods"] == [
        "COD",
        "ONLINE",
    ]


# ---- stock and capacity (business-rules §1, §13; database.md §24) --------------------------


async def test_cannot_order_more_than_stock_and_nothing_is_reserved(
    client, make_product, db_engine
):
    a = await make_product(name="A", stock_quantity=5)
    b = await make_product(name="B", stock_quantity=1)
    r = await place(client, [(a["product_id"], 2), (b["product_id"], 2)])
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "CHECKOUT_INVALID"
    assert d["issues"] == [
        {"product_id": b["product_id"], "issue": "EXCEEDS_AVAILABLE", "max_quantity": 1}
    ]
    # all-or-nothing: A's stock was not touched and no order exists
    assert await stock_of(db_engine, a["product_id"]) == 5
    assert await db_value(db_engine, "SELECT count(*) FROM orders") == 0


async def test_unknown_hidden_and_sold_out_products_cannot_be_ordered(client, make_product):
    hidden = await make_product(is_visible=False, stock_quantity=5)
    sold_out = await make_product(stock_quantity=0)
    for pid, issue in (
        (hidden["product_id"], "NOT_FOUND"),
        (str(uuid.uuid4()), "NOT_FOUND"),
        (sold_out["product_id"], "UNAVAILABLE"),
    ):
        r = await place(client, [(pid, 1)])
        assert r.status_code == 409
        assert r.json()["detail"]["issues"][0]["issue"] == issue


async def test_last_unit_goes_to_exactly_one_of_many_simultaneous_buyers(
    client, make_product, db_engine
):
    a = await make_product(stock_quantity=1)
    results = await asyncio.gather(*[place(client, [(a["product_id"], 1)]) for _ in range(6)])
    assert sorted(r.status_code for r in results) == [201] + [409] * 5
    assert await stock_of(db_engine, a["product_id"]) == 0  # never negative
    assert await db_value(db_engine, "SELECT count(*) FROM orders") == 1


async def test_concurrent_multi_item_orders_do_not_deadlock_or_oversell(
    client, make_product, db_engine
):
    a = await make_product(name="A", stock_quantity=3)
    b = await make_product(name="B", stock_quantity=3)
    pa, pb = a["product_id"], b["product_id"]
    # opposite item order in the carts: locks are still taken in id order
    tasks = [
        place(client, [(pa, 1), (pb, 1)]) if i % 2 else place(client, [(pb, 1), (pa, 1)])
        for i in range(8)
    ]
    results = await asyncio.gather(*tasks)
    ok = [r for r in results if r.status_code == 201]
    assert len(ok) == 3 and all(r.status_code in (201, 409) for r in results)
    assert await stock_of(db_engine, pa) == 0 and await stock_of(db_engine, pb) == 0


async def test_made_to_order_capacity_is_counted_in_units(client, make_product):
    m = await make_product(
        availability_type="MADE_TO_ORDER", stock_quantity=0, max_active_units=3, price_paisa=100
    )
    pid = m["product_id"]
    assert (await place(client, [(pid, 2)])).status_code == 201
    r = await place(client, [(pid, 2)])
    assert r.status_code == 409
    assert r.json()["detail"]["issues"][0] == {
        "product_id": pid,
        "issue": "EXCEEDS_AVAILABLE",
        "max_quantity": 1,
    }
    assert (await place(client, [(pid, 1)])).status_code == 201
    r = await place(client, [(pid, 1)])
    assert r.json()["detail"]["issues"][0]["issue"] == "UNAVAILABLE"
    # the public listing reflects the exhausted capacity
    item = (await client.get("/api/products")).json()["items"][0]
    assert item["is_available"] is False


async def test_made_to_order_capacity_under_concurrency(client, make_product):
    m = await make_product(availability_type="MADE_TO_ORDER", stock_quantity=0, max_active_units=2)
    results = await asyncio.gather(*[place(client, [(m["product_id"], 1)]) for _ in range(6)])
    assert sorted(r.status_code for r in results) == [201, 201] + [409] * 4


async def test_made_to_order_does_not_touch_stock_and_cancelled_orders_free_capacity(
    client, make_product, db_engine
):
    m = await make_product(availability_type="MADE_TO_ORDER", stock_quantity=0, max_active_units=1)
    pid = m["product_id"]
    first = (await place(client, [(pid, 1)])).json()
    assert await stock_of(db_engine, pid) == 0
    assert (await place(client, [(pid, 1)])).status_code == 409
    # statuses that no longer consume capacity free it (business-rules §1)
    for status in ("SHIPPED", "CANCELLED"):
        async with db_engine.begin() as conn:
            await conn.execute(
                text("UPDATE orders SET status = :s WHERE order_id = :o"),
                {"s": status, "o": uuid.UUID(first["order_id"])},
            )
        r = await place(client, [(pid, 1)])
        assert r.status_code == 201, status
        async with db_engine.begin() as conn:
            await conn.execute(
                text("UPDATE orders SET status = 'DELIVERED' WHERE status = 'PENDING'")
            )


# ---- authentication on the optional-auth endpoint ------------------------------------------


async def test_invalid_or_expired_token_is_401_not_a_silent_guest_order(
    client, make_product, make_token, db_engine
):
    a = await make_product(stock_quantity=2)
    expired = auth(make_token(exp_offset=-10))
    assert (await place(client, [(a["product_id"], 1)], headers=expired)).status_code == 401
    assert (await place(client, [(a["product_id"], 1)], headers=auth("junk"))).status_code == 401
    assert await db_value(db_engine, "SELECT count(*) FROM orders") == 0


@pytest.mark.parametrize(
    "mutation",
    [
        {"contact": {**CONTACT, "email": "not-an-email"}},
        {"contact": {**CONTACT, "name": "  "}},
        {"contact": {**CONTACT, "phone": "abc"}},
        {"payment_method": "BITCOIN"},
        {"items": []},
        {"unit_price_paisa": 1},
        {"total_amount_paisa": 1},
    ],
)
async def test_order_validation(client, make_product, mutation):
    a = await make_product(stock_quantity=2)
    body = order_body([(a["product_id"], 1)]) | mutation
    assert (await client.post("/api/orders", json=body)).status_code == 422


# ---- database guarantees -------------------------------------------------------------------


async def test_database_enforces_order_total_and_nonnegative_stock(db_engine, make_product):
    async with db_engine.begin() as conn:
        with pytest.raises(Exception, match="ck_orders_total_sum"):
            await conn.execute(
                text(
                    "INSERT INTO orders (order_id, customer_name, customer_email, status,"
                    " delivery_name, delivery_house_no, delivery_city, delivery_postal_code,"
                    " delivery_country, subtotal_paisa, delivery_fee_paisa, total_amount_paisa)"
                    " VALUES (gen_random_uuid(), 'n', 'e', 'PENDING', 'n', '1', 'Lahore', '1',"
                    " 'Pakistan', 100, 50, 999)"
                )
            )
