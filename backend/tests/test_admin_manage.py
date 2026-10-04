import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth
from tests.test_checkout import place
from tests.test_orders_customer import set_status

ADMIN = "/api/admin"


@pytest.fixture
def alice(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="alice@example.com", name="Alice Khan"))


@pytest.fixture
def bob(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="bob@example.com", name="Bob Ali"))


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", f"{ADMIN}/dashboard"),
        ("GET", f"{ADMIN}/customers"),
        ("GET", f"{ADMIN}/customers/{uuid.uuid4()}"),
        ("GET", f"{ADMIN}/categories"),
        ("GET", f"{ADMIN}/settings"),
        ("PATCH", f"{ADMIN}/settings"),
    ],
)
async def test_admin_management_routes_need_the_admin_role(client, customer_h, method, url):
    assert (await client.request(method, url, json={})).status_code == 401
    assert (await client.request(method, url, headers=customer_h, json={})).status_code == 403


# ---- dashboard -----------------------------------------------------------------------------


async def test_empty_dashboard(client, admin_h):
    body = (await client.get(f"{ADMIN}/dashboard", headers=admin_h)).json()
    assert body["orders_needing_action"] == 0
    assert body["orders_by_status"] == {
        "PENDING": 0,
        "CONFIRMED": 0,
        "PROCESSING": 0,
        "SHIPPED": 0,
        "DELIVERED": 0,
        "CANCELLED": 0,
    }
    assert (body["new_messages"], body["new_custom_orders"]) == (0, 0)
    assert body["recent_orders"] == [] and body["low_stock_products"] == []


async def test_dashboard_counts_what_needs_attention(
    client, online_enabled, admin_h, make_product, db_engine
):
    a = await make_product(name="Plenty", stock_quantity=50)
    await make_product(name="Almost gone", stock_quantity=2)
    await make_product(name="Sold out", stock_quantity=0)
    await make_product(
        name="Made to order",
        availability_type="MADE_TO_ORDER",
        stock_quantity=0,
        max_active_units=5,
    )
    pid = a["product_id"]
    cod_pending = (await place(client, [(pid, 1)])).json()
    cod_confirmed = (await place(client, [(pid, 1)])).json()
    await set_status(db_engine, cod_confirmed["order_id"], "CONFIRMED")
    await place(
        client, [(pid, 1)], method="ONLINE"
    )  # waiting for the customer: not "action needed"
    shipped = (await place(client, [(pid, 1)])).json()
    await set_status(db_engine, shipped["order_id"], "SHIPPED")
    await client.post("/api/contact", json={"name": "S", "email": "s@example.com", "message": "hi"})
    await client.post(
        "/api/custom-orders",
        json={"name": "S", "whatsapp_number": "0300 1234567", "description": "A jersey"},
    )

    body = (await client.get(f"{ADMIN}/dashboard", headers=admin_h)).json()
    status = body["orders_by_status"]
    assert (status["PENDING"], status["CONFIRMED"], status["SHIPPED"]) == (2, 1, 1)
    assert body["orders_needing_action"] == 2  # the pending COD order and the confirmed one
    assert (body["new_messages"], body["new_custom_orders"]) == (1, 1)
    names = [p["name"] for p in body["low_stock_products"]]
    assert names == ["Sold out", "Almost gone"]  # ready-to-ship only, lowest first
    assert body["low_stock_threshold"] == 3
    assert len(body["recent_orders"]) == 4
    assert cod_pending["order_id"] in [o["order_id"] for o in body["recent_orders"]]
    assert body["recent_orders"][0]["customer_name"]


async def test_dashboard_limits_recent_orders_to_five(client, admin_h, make_product):
    a = await make_product(stock_quantity=50)
    for _ in range(7):
        await place(client, [(a["product_id"], 1)])
    body = (await client.get(f"{ADMIN}/dashboard", headers=admin_h)).json()
    assert len(body["recent_orders"]) == 5 and body["orders_by_status"]["PENDING"] == 7


# ---- customers -----------------------------------------------------------------------------


async def test_customer_list_search_and_counts(client, admin_h, make_product, alice, bob):
    a = await make_product(stock_quantity=20)
    await place(client, [(a["product_id"], 1)], headers=alice)
    await place(client, [(a["product_id"], 1)], headers=alice)
    await client.get("/api/customers/me", headers=bob)  # registered, no orders
    page = (await client.get(f"{ADMIN}/customers", headers=admin_h)).json()
    assert page["total"] == 2
    by_name = {c["name"]: c for c in page["items"]}
    assert by_name["Alice Khan"]["order_count"] == 2 and by_name["Bob Ali"]["order_count"] == 0
    assert by_name["Alice Khan"]["email"] == "alice@example.com"
    assert "password" not in str(page)
    found = (
        await client.get(f"{ADMIN}/customers", headers=admin_h, params={"search": "ALICE"})
    ).json()
    assert [c["name"] for c in found["items"]] == ["Alice Khan"]
    assert (
        await client.get(f"{ADMIN}/customers", headers=admin_h, params={"search": "bob@"})
    ).json()["total"] == 1
    assert (await client.get(f"{ADMIN}/customers", headers=admin_h, params={"search": "%"})).json()[
        "total"
    ] == 0
    p2 = (
        await client.get(f"{ADMIN}/customers", headers=admin_h, params={"page": 2, "page_size": 1})
    ).json()
    assert len(p2["items"]) == 1
    assert (
        await client.get(f"{ADMIN}/customers", headers=admin_h, params={"page_size": 101})
    ).status_code == 422


async def test_customer_detail(client, admin_h, make_product, alice):
    a = await make_product(stock_quantity=20)
    for _ in range(2):
        await place(client, [(a["product_id"], 1)], headers=alice)
    await client.post(
        "/api/custom-orders",
        headers=alice,
        json={"name": "A", "whatsapp_number": "0300 1234567", "description": "Jersey"},
    )
    cid = (await client.get("/api/customers/me", headers=alice)).json()["customer_id"]
    detail = (await client.get(f"{ADMIN}/customers/{cid}", headers=admin_h)).json()
    assert (detail["order_count"], detail["custom_order_count"]) == (2, 1)
    assert len(detail["recent_orders"]) == 2
    assert detail["subscribed_to_updates"] is True
    assert (
        await client.get(f"{ADMIN}/customers/{uuid.uuid4()}", headers=admin_h)
    ).status_code == 404
    assert (await client.get(f"{ADMIN}/customers/nope", headers=admin_h)).status_code == 422


# ---- categories ----------------------------------------------------------------------------


async def test_admin_category_list_has_product_counts(client, admin_h, make_product, category_id):
    await make_product(name="One")
    await make_product(name="Two")
    other = (
        await client.post(f"{ADMIN}/categories", headers=admin_h, json={"name": "Empty"})
    ).json()
    rows = (await client.get(f"{ADMIN}/categories", headers=admin_h)).json()
    counts = {r["name"]: r["product_count"] for r in rows}
    assert counts == {"Empty": 0, "Flowers": 2}
    assert other["category_id"] in [r["category_id"] for r in rows]


# ---- business settings (business-rules §33) ------------------------------------------------


async def test_admin_can_read_and_update_settings_and_the_public_sees_them(client, admin_h):
    before = (await client.get(f"{ADMIN}/settings", headers=admin_h)).json()
    assert before["delivery_fee_paisa"] == 20000 and before["social_links"] == {}
    r = await client.patch(
        f"{ADMIN}/settings",
        headers=admin_h,
        json={
            "business_name": "  Bundle of Loops ",
            "email": "Shop@Example.com",
            "phone": "+92 42 1111111",
            "whatsapp": "0300 1234567",
            "address": "Lahore",
            "delivery_information": "Delivered within 3 days",
            "delivery_fee_paisa": 25000,
            "social_links": {"instagram": "https://instagram.com/bundleofloops"},
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["business_name"], body["email"], body["delivery_fee_paisa"]) == (
        "Bundle of Loops",
        "shop@example.com",
        25000,
    )
    public = (await client.get("/api/settings")).json()  # no login needed
    assert public["whatsapp"] == "0300 1234567"
    assert public["social_links"] == {"instagram": "https://instagram.com/bundleofloops"}
    assert "updated_at" not in public and "setting_id" not in public


async def test_partial_update_keeps_other_fields_and_null_clears_optional_ones(client, admin_h):
    await client.patch(
        f"{ADMIN}/settings", headers=admin_h, json={"phone": "03001234567", "address": "Lahore"}
    )
    r = await client.patch(f"{ADMIN}/settings", headers=admin_h, json={"address": None})
    assert (r.json()["phone"], r.json()["address"]) == ("03001234567", None)
    r = await client.patch(f"{ADMIN}/settings", headers=admin_h, json={"social_links": None})
    assert r.json()["social_links"] == {}
    r = await client.patch(f"{ADMIN}/settings", headers=admin_h, json={"phone": ""})
    assert r.json()["phone"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"delivery_fee_paisa": -1},
        {"delivery_fee_paisa": 10**9},
        {"delivery_fee_paisa": None},
        {"delivery_fee_paisa": 12.5},
        {"email": "not-an-email"},
        {"phone": "abc"},
        {"business_name": "x" * 101},
        {"social_links": {"insta": "http://insecure.example"}},
        {"social_links": {"insta": "javascript:alert(1)"}},
        {"social_links": {"Bad Key": "https://x.example"}},
        {"social_links": {f"k{i}": "https://x.example" for i in range(11)}},
        {"setting_id": str(uuid.uuid4())},
        {"holiday_mode": True},
    ],
)
async def test_settings_validation(client, admin_h, body):
    assert (await client.patch(f"{ADMIN}/settings", headers=admin_h, json=body)).status_code == 422


async def test_changing_the_delivery_fee_changes_new_quotes_but_not_existing_orders(
    client, admin_h, make_product
):
    a = await make_product(stock_quantity=10, price_paisa=1000)
    old = (await place(client, [(a["product_id"], 1)])).json()
    await client.patch(f"{ADMIN}/settings", headers=admin_h, json={"delivery_fee_paisa": 35000})
    quote = (
        await client.post(
            "/api/checkout/quote", json={"items": [{"product_id": a["product_id"], "quantity": 1}]}
        )
    ).json()
    assert quote["delivery_fee_paisa"] == 35000 and quote["total_paisa"] == 36000
    unchanged = (await client.get(f"{ADMIN}/orders/{old['order_id']}", headers=admin_h)).json()
    assert unchanged["delivery_fee_paisa"] == 20000  # the order keeps what the customer agreed to


async def test_settings_row_is_created_if_missing(client, admin_h, db_engine):
    async with db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM business_settings"))
    got = await client.get(f"{ADMIN}/settings", headers=admin_h)
    assert got.status_code == 200 and got.json()["delivery_fee_paisa"] == 0
    assert (await client.get("/api/settings")).status_code == 200


# ---- product availability type guard -------------------------------------------------------


async def test_availability_type_cannot_change_while_orders_are_active(
    client, admin_h, make_product, db_engine
):
    p = await make_product(stock_quantity=5)
    pid = p["product_id"]
    o = (await place(client, [(pid, 1)])).json()
    url = f"{ADMIN}/products/{pid}"
    r = await client.patch(url, headers=admin_h, json={"availability_type": "MADE_TO_ORDER"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ACTIVE_ORDERS"
    # other edits are fine, and "changing" to the same type is not a change
    assert (await client.patch(url, headers=admin_h, json={"price_paisa": 999})).status_code == 200
    assert (
        await client.patch(url, headers=admin_h, json={"availability_type": "READY_TO_SHIP"})
    ).status_code == 200
    for state in ("SHIPPED", "DELIVERED", "CANCELLED"):  # inactive orders no longer matter
        await set_status(db_engine, o["order_id"], state)
        r = await client.patch(url, headers=admin_h, json={"availability_type": "MADE_TO_ORDER"})
        assert r.status_code == 200, state
        await client.patch(url, headers=admin_h, json={"availability_type": "READY_TO_SHIP"})


# ---- NEW_PRODUCT notifications -------------------------------------------------------------


async def notes(client, headers):
    return (await client.get("/api/customers/me/notifications", headers=headers)).json()["items"]


async def test_publishing_a_product_notifies_subscribed_customers_only(
    client, admin_h, make_product, alice, bob
):
    await client.get("/api/customers/me", headers=alice)
    await client.get("/api/customers/me", headers=bob)
    await client.patch("/api/customers/me", headers=bob, json={"subscribed_to_updates": False})

    p = await make_product(name="Mint Frog", is_visible=False)
    assert await notes(client, alice) == []  # hidden products are not announced
    r = await client.patch(
        f"{ADMIN}/products/{p['product_id']}", headers=admin_h, json={"is_visible": True}
    )
    assert r.status_code == 200
    got = await notes(client, alice)
    assert [(n["type"], n["status"]) for n in got] == [("NEW_PRODUCT", "UNREAD")]
    assert "Mint Frog" in got[0]["message"]
    assert await notes(client, bob) == []  # unsubscribed


async def test_creating_a_visible_product_notifies_and_other_edits_do_not(
    client, admin_h, make_product, alice
):
    await client.get("/api/customers/me", headers=alice)
    p = await make_product(name="Daisy", is_visible=True)
    assert len(await notes(client, alice)) == 1
    url = f"{ADMIN}/products/{p['product_id']}"
    await client.patch(url, headers=admin_h, json={"price_paisa": 500, "is_featured": True})
    await client.patch(url, headers=admin_h, json={"is_visible": True})  # already visible
    assert len(await notes(client, alice)) == 1
    await client.patch(url, headers=admin_h, json={"is_visible": False})
    assert len(await notes(client, alice)) == 1  # hiding announces nothing


async def test_publishing_with_many_customers_is_one_statement(
    client, admin_h, make_product, db_engine
):
    async with db_engine.begin() as conn:
        for i in range(50):
            await conn.execute(
                text(
                    "INSERT INTO customers (customer_id, name, email) VALUES (gen_random_uuid(), 'N', :e)"
                ),
                {"e": f"bulk{i}@example.com"},
            )
    await make_product(name="Bulk Item", is_visible=True)
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM notifications"))).scalar() == 50
