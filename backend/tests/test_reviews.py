import asyncio
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth
from tests.test_checkout import place

ADMIN = "/api/admin"


@pytest.fixture
def alice(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="alice@example.com", name="Alice Khan"))


@pytest.fixture
def bob(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="bob@example.com", name="Bob Ali"))


def rurl(pid):
    return f"/api/products/{pid}/reviews"


async def delivered(client, admin_h, headers, product_id):
    """Place an order as this customer and take it all the way to Delivered."""
    r = await place(client, [(product_id, 1)], headers=headers)
    assert r.status_code == 201, r.text
    oid = r.json()["order_id"]
    for status in ("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"):
        step = await client.post(
            f"{ADMIN}/orders/{oid}/status", headers=admin_h, json={"status": status}
        )
        assert step.status_code == 200, step.text
    return oid


@pytest.mark.parametrize(
    ("method", "suffix"), [("GET", "/me"), ("POST", ""), ("PATCH", "/me"), ("DELETE", "/me")]
)
async def test_review_writes_require_login(client, make_product, method, suffix):
    p = await make_product()
    assert (
        await client.request(method, rurl(p["product_id"]) + suffix, json={})
    ).status_code == 401


async def test_public_list_when_empty_and_for_unknown_or_hidden_products(client, make_product):
    p = await make_product()
    body = (await client.get(rurl(p["product_id"]))).json()
    assert (body["total"], body["average_rating"], body["rating_count"]) == (0, None, 0)
    hidden = await make_product(is_visible=False)
    assert (await client.get(rurl(hidden["product_id"]))).status_code == 404
    assert (await client.get(rurl(uuid.uuid4()))).status_code == 404
    assert (await client.get(rurl(p["product_id"]), params={"page_size": 51})).status_code == 422


# ---- eligibility (business-rules §26) ------------------------------------------------------


async def test_review_requires_a_delivered_order_containing_the_product(
    client, admin_h, make_product, alice
):
    p, other = (
        await make_product(stock_quantity=20),
        await make_product(name="Other", stock_quantity=20),
    )
    url = rurl(p["product_id"])
    body = {"rating": 5, "comment": "Lovely"}

    no_order = await client.post(url, headers=alice, json=body)
    assert no_order.status_code == 403 and no_order.json()["detail"]["code"] == "NOT_ELIGIBLE"

    pending = await place(client, [(p["product_id"], 1)], headers=alice)
    assert (await client.post(url, headers=alice, json=body)).status_code == 403  # only Pending
    for status in ("CONFIRMED", "PROCESSING", "SHIPPED"):
        await client.post(
            f"{ADMIN}/orders/{pending.json()['order_id']}/status",
            headers=admin_h,
            json={"status": status},
        )
        assert (await client.post(url, headers=alice, json=body)).status_code == 403, status

    await delivered(
        client, admin_h, alice, other["product_id"]
    )  # delivered, but a different product
    assert (await client.post(url, headers=alice, json=body)).status_code == 403

    await client.post(
        f"{ADMIN}/orders/{pending.json()['order_id']}/status",
        headers=admin_h,
        json={"status": "DELIVERED"},
    )
    ok = await client.post(url, headers=alice, json=body)
    assert ok.status_code == 201, ok.text
    assert (ok.json()["rating"], ok.json()["comment"], ok.json()["author"]) == (
        5,
        "Lovely",
        "Alice",
    )


async def test_a_cancelled_order_or_someone_elses_delivery_does_not_qualify(
    client, admin_h, make_product, alice, bob
):
    p = await make_product(stock_quantity=20)
    url = rurl(p["product_id"])
    await delivered(client, admin_h, bob, p["product_id"])  # Bob bought it, not Alice
    assert (await client.post(url, headers=alice, json={"rating": 5})).status_code == 403
    cancelled = await place(client, [(p["product_id"], 1)], headers=alice)
    await client.post(f"/api/orders/{cancelled.json()['order_id']}/cancel", headers=alice)
    assert (await client.post(url, headers=alice, json={"rating": 5})).status_code == 403


async def test_guest_orders_never_give_review_rights(client, admin_h, make_product, alice):
    p = await make_product(stock_quantity=5)
    g = (await place(client, [(p["product_id"], 1)])).json()
    for status in ("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"):
        await client.post(
            f"{ADMIN}/orders/{g['order_id']}/status", headers=admin_h, json={"status": status}
        )
    assert (
        await client.post(rurl(p["product_id"]), headers=alice, json={"rating": 4})
    ).status_code == 403


async def test_my_review_state(client, admin_h, make_product, alice):
    p = await make_product(stock_quantity=5)
    url = rurl(p["product_id"])
    assert (await client.get(url + "/me", headers=alice)).json() == {
        "eligible": False,
        "review": None,
    }
    await delivered(client, admin_h, alice, p["product_id"])
    state = (await client.get(url + "/me", headers=alice)).json()
    assert (state["eligible"], state["review"]) == (True, None)
    await client.post(url, headers=alice, json={"rating": 3, "comment": "ok"})
    state = (await client.get(url + "/me", headers=alice)).json()
    assert state["eligible"] is True and state["review"]["rating"] == 3


# ---- validation and the one-review rule ----------------------------------------------------


@pytest.fixture
async def eligible(client, admin_h, make_product, alice):
    p = await make_product(stock_quantity=5)
    oid = await delivered(client, admin_h, alice, p["product_id"])
    return p, oid


@pytest.mark.parametrize(
    "body",
    [
        {"rating": 0},
        {"rating": 6},
        {"rating": "five"},
        {"rating": 4.5},
        {},
        {"rating": 5, "comment": "x" * 2001},
        {"rating": 5, "order_id": "x"},
        {"rating": 5, "customer_id": str(uuid.uuid4())},
    ],
)
async def test_review_validation(client, alice, eligible, body):
    p, _ = eligible
    assert (await client.post(rurl(p["product_id"]), headers=alice, json=body)).status_code == 422


async def test_comment_is_trimmed_and_optional(client, alice, eligible):
    p, oid = eligible
    r = await client.post(
        rurl(p["product_id"]), headers=alice, json={"rating": 5, "comment": "   "}
    )
    assert r.status_code == 201 and r.json()["comment"] is None


async def test_one_review_per_customer_per_product(client, alice, eligible, db_engine):
    p, oid = eligible
    url = rurl(p["product_id"])
    assert (await client.post(url, headers=alice, json={"rating": 5})).status_code == 201
    again = await client.post(url, headers=alice, json={"rating": 1})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "ALREADY_REVIEWED"
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT order_id FROM reviews"))).scalar() == uuid.UUID(oid)


async def test_simultaneous_submissions_create_one_review(client, alice, eligible, db_engine):
    p, _ = eligible
    results = await asyncio.gather(
        *[client.post(rurl(p["product_id"]), headers=alice, json={"rating": 5}) for _ in range(6)]
    )
    assert sorted(r.status_code for r in results) == [201] + [409] * 5
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM reviews"))).scalar() == 1


async def test_database_enforces_the_rating_range(db_engine, client, alice, eligible):
    p, oid = eligible
    async with db_engine.begin() as conn:
        with pytest.raises(Exception, match="ck_reviews_rating_range"):
            await conn.execute(
                text(
                    "INSERT INTO reviews (review_id, order_id, product_name_snapshot, rating)"
                    " VALUES (gen_random_uuid(), :o, 'x', 9)"
                ),
                {"o": uuid.UUID(oid)},
            )


# ---- edit, delete (decided: customers manage their own) ------------------------------------


async def test_customer_can_edit_and_delete_own_review(client, alice, eligible):
    p, _ = eligible
    url = rurl(p["product_id"])
    await client.post(url, headers=alice, json={"rating": 2, "comment": "meh"})
    r = await client.patch(url + "/me", headers=alice, json={"rating": 5})
    assert (r.json()["rating"], r.json()["comment"]) == (5, "meh")  # untouched field kept
    r = await client.patch(url + "/me", headers=alice, json={"comment": "great!"})
    assert (r.json()["rating"], r.json()["comment"]) == (5, "great!")
    r = await client.patch(url + "/me", headers=alice, json={"comment": None})
    assert r.json()["comment"] is None
    for bad in ({}, {"rating": None}, {"rating": 9}):
        assert (await client.patch(url + "/me", headers=alice, json=bad)).status_code == 422
    assert (await client.delete(url + "/me", headers=alice)).status_code == 204
    assert (await client.delete(url + "/me", headers=alice)).status_code == 404
    assert (await client.patch(url + "/me", headers=alice, json={"rating": 1})).status_code == 404
    # deleting frees the slot: the customer may review again
    assert (await client.post(url, headers=alice, json={"rating": 4})).status_code == 201


async def test_customers_cannot_touch_each_others_reviews(
    client, admin_h, make_product, alice, bob
):
    p = await make_product(stock_quantity=10)
    await delivered(client, admin_h, alice, p["product_id"])
    await delivered(client, admin_h, bob, p["product_id"])
    url = rurl(p["product_id"])
    await client.post(url, headers=alice, json={"rating": 5, "comment": "Alice's"})
    # Bob has his own (separate) review slot; his edits never reach Alice's review
    assert (await client.patch(url + "/me", headers=bob, json={"rating": 1})).status_code == 404
    await client.post(url, headers=bob, json={"rating": 1, "comment": "Bob's"})
    await client.patch(url + "/me", headers=bob, json={"rating": 2})
    await client.delete(url + "/me", headers=bob)
    items = (await client.get(url)).json()["items"]
    assert [(i["author"], i["rating"]) for i in items] == [("Alice", 5)]


# ---- public list ---------------------------------------------------------------------------


async def test_public_list_shows_first_names_average_and_pages(
    client, admin_h, make_product, alice, bob
):
    p = await make_product(stock_quantity=10)
    await delivered(client, admin_h, alice, p["product_id"])
    await delivered(client, admin_h, bob, p["product_id"])
    url = rurl(p["product_id"])
    await client.post(url, headers=alice, json={"rating": 5, "comment": "First"})
    await client.post(url, headers=bob, json={"rating": 2, "comment": "Second"})
    body = (await client.get(url)).json()
    assert [(i["author"], i["comment"]) for i in body["items"]] == [
        ("Bob", "Second"),
        ("Alice", "First"),
    ]
    assert (body["average_rating"], body["rating_count"], body["total"]) == (3.5, 2, 2)
    text_ = (await client.get(url)).text
    assert "Khan" not in text_ and "alice@example.com" not in text_  # nothing beyond the first name
    p2 = (await client.get(url, params={"page": 2, "page_size": 1})).json()
    assert [i["author"] for i in p2["items"]] == ["Alice"]


async def test_reviews_survive_deleted_customers_and_products(
    client, admin_h, make_product, alice, db_engine
):
    p = await make_product(name="Sunflower", stock_quantity=10)
    other = await make_product(name="Keeper", stock_quantity=10)
    for prod in (p, other):
        await delivered(client, admin_h, alice, prod["product_id"])
        await client.post(rurl(prod["product_id"]), headers=alice, json={"rating": 4})
    async with db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM customers"))  # the account is deleted
    shown = (await client.get(rurl(other["product_id"]))).json()["items"]
    assert shown[0]["author"] == "Former customer"
    await client.delete(f"{ADMIN}/products/{p['product_id']}", headers=admin_h)  # product deleted
    rows = (await client.get(f"{ADMIN}/reviews", headers=admin_h)).json()["items"]
    gone = next(r for r in rows if r["product_name_snapshot"] == "Sunflower")
    assert gone["product_id"] is None and gone["customer_id"] is None  # history kept, links cleared


# ---- admin ---------------------------------------------------------------------------------


async def test_admin_can_list_and_remove_any_review(
    client, admin_h, customer_h, make_product, alice
):
    p = await make_product(stock_quantity=5)
    await delivered(client, admin_h, alice, p["product_id"])
    created = (
        await client.post(
            rurl(p["product_id"]), headers=alice, json={"rating": 1, "comment": "bad"}
        )
    ).json()
    listed = (
        await client.get(
            f"{ADMIN}/reviews", headers=admin_h, params={"product_id": p["product_id"]}
        )
    ).json()
    assert listed["total"] == 1
    assert listed["items"][0]["customer_name"] == "Alice Khan"  # admins see the full name
    other = await make_product(name="Other")
    assert (
        await client.get(
            f"{ADMIN}/reviews", headers=admin_h, params={"product_id": other["product_id"]}
        )
    ).json()["total"] == 0

    assert (
        await client.delete(f"{ADMIN}/reviews/{created['review_id']}", headers=customer_h)
    ).status_code == 403
    assert (await client.delete(f"{ADMIN}/reviews/{created['review_id']}")).status_code == 401
    assert (
        await client.delete(f"{ADMIN}/reviews/{created['review_id']}", headers=admin_h)
    ).status_code == 204
    assert (
        await client.delete(f"{ADMIN}/reviews/{created['review_id']}", headers=admin_h)
    ).status_code == 404
    assert (await client.get(rurl(p["product_id"]))).json()["total"] == 0
    assert (await client.get(f"{ADMIN}/reviews")).status_code == 401
    assert (await client.get(f"{ADMIN}/reviews", headers=customer_h)).status_code == 403
