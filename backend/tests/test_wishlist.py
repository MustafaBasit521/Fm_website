import asyncio
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth

URL = "/api/customers/me/wishlist"


@pytest.fixture
def alice(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="alice@example.com", name="Alice"))


@pytest.fixture
def bob(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="bob@example.com", name="Bob"))


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", URL),
        ("GET", f"{URL}/ids"),
        ("POST", URL),
        ("DELETE", f"{URL}/{uuid.uuid4()}"),
    ],
)
async def test_wishlist_is_for_registered_customers_only(client, method, url):
    assert (await client.request(method, url, json={})).status_code == 401


async def add(client, headers, product_id):
    return await client.post(URL, headers=headers, json={"product_id": product_id})


async def test_add_list_remove(client, alice, make_product):
    p1, p2 = await make_product(name="One"), await make_product(name="Two")
    assert (await add(client, alice, p1["product_id"])).status_code == 201
    assert (await add(client, alice, p2["product_id"])).status_code == 201
    page = (await client.get(URL, headers=alice)).json()
    assert page["total"] == 2
    assert [i["name"] for i in page["items"]] == ["Two", "One"]  # newest first
    assert page["items"][0]["is_available"] is True
    ids = (await client.get(f"{URL}/ids", headers=alice)).json()
    assert sorted(ids) == sorted([p1["product_id"], p2["product_id"]])

    assert (await client.delete(f"{URL}/{p1['product_id']}", headers=alice)).status_code == 204
    assert [i["name"] for i in (await client.get(URL, headers=alice)).json()["items"]] == ["Two"]
    # removing again is a harmless no-op
    assert (await client.delete(f"{URL}/{p1['product_id']}", headers=alice)).status_code == 204


async def test_same_product_cannot_be_added_twice(client, alice, make_product, db_engine):
    p = await make_product()
    assert (await add(client, alice, p["product_id"])).status_code == 201
    assert (await add(client, alice, p["product_id"])).status_code == 409
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM wishlist_items"))).scalar() == 1


async def test_concurrent_double_add_creates_one_row(client, alice, make_product, db_engine):
    p = await make_product()
    results = await asyncio.gather(*[add(client, alice, p["product_id"]) for _ in range(6)])
    assert sorted(r.status_code for r in results) == [201] + [409] * 5
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM wishlist_items"))).scalar() == 1


async def test_cannot_add_unknown_or_hidden_products(client, alice, make_product):
    hidden = await make_product(is_visible=False)
    assert (await add(client, alice, hidden["product_id"])).status_code == 404
    assert (await add(client, alice, str(uuid.uuid4()))).status_code == 404
    assert (await client.post(URL, headers=alice, json={"product_id": "nope"})).status_code == 422
    assert (await client.post(URL, headers=alice, json={})).status_code == 422


async def test_wishlists_are_private_per_customer(client, alice, bob, make_product):
    p = await make_product()
    await add(client, alice, p["product_id"])
    assert (await client.get(URL, headers=bob)).json()["total"] == 0
    assert (await client.get(f"{URL}/ids", headers=bob)).json() == []
    # Bob removing the same product id must not touch Alice's list.
    await client.delete(f"{URL}/{p['product_id']}", headers=bob)
    assert (await client.get(URL, headers=alice)).json()["total"] == 1
    # Both may wishlist the same product independently.
    assert (await add(client, bob, p["product_id"])).status_code == 201


async def test_hidden_products_disappear_but_rows_are_kept(client, alice, admin_h, make_product):
    p = await make_product()
    await add(client, alice, p["product_id"])
    await client.patch(
        f"/api/admin/products/{p['product_id']}", headers=admin_h, json={"is_visible": False}
    )
    assert (await client.get(URL, headers=alice)).json()["total"] == 0
    assert (await client.get(f"{URL}/ids", headers=alice)).json() == []
    await client.patch(
        f"/api/admin/products/{p['product_id']}", headers=admin_h, json={"is_visible": True}
    )
    assert (await client.get(URL, headers=alice)).json()["total"] == 1


async def test_pagination(client, alice, make_product):
    for i in range(3):
        await add(client, alice, (await make_product(name=f"P{i}"))["product_id"])
    page2 = (await client.get(URL, headers=alice, params={"page": 2, "page_size": 2})).json()
    assert (page2["total"], len(page2["items"])) == (3, 1)
    assert (await client.get(URL, headers=alice, params={"page_size": 51})).status_code == 422


async def test_deleting_a_product_removes_it_from_wishlists(client, alice, admin_h, make_product):
    p = await make_product()
    await add(client, alice, p["product_id"])
    assert (
        await client.delete(f"/api/admin/products/{p['product_id']}", headers=admin_h)
    ).status_code == 204
    assert (await client.get(URL, headers=alice)).json()["total"] == 0


async def test_deleting_a_customer_removes_their_wishlist(client, alice, make_product, db_engine):
    p = await make_product()
    await add(client, alice, p["product_id"])
    async with db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM customers"))
        assert (await conn.execute(text("SELECT count(*) FROM wishlist_items"))).scalar() == 0
