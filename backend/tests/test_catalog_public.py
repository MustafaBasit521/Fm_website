import pytest


async def names(client, **params):
    r = await client.get("/api/products", params=params)
    assert r.status_code == 200, r.text
    return [p["name"] for p in r.json()["items"]]


async def test_categories_listed_alphabetically(client, admin_h):
    for n in ("Zeta", "Alpha"):
        await client.post("/api/admin/categories", headers=admin_h, json={"name": n})
    r = await client.get("/api/categories")
    assert [c["name"] for c in r.json()] == ["Alpha", "Zeta"]


async def test_hidden_products_never_public(client, make_product):
    hidden = await make_product(name="Hidden", is_visible=False)
    await make_product(name="Shown")
    assert await names(client) == ["Shown"]
    r = await client.get(f"/api/products/{hidden['product_id']}")
    assert r.status_code == 404


async def test_detail_and_no_internal_fields_leak(client, make_product):
    p = await make_product()
    body = (await client.get(f"/api/products/{p['product_id']}")).json()
    assert body["name"] == "Sunflower"
    assert body["price_paisa"] == 125050
    assert body["description"] == "A bright crochet sunflower"
    for private in ("stock_quantity", "max_active_units", "is_visible", "created_at"):
        assert private not in body


async def test_unknown_product_is_404(client):
    assert (
        await client.get("/api/products/00000000-0000-0000-0000-000000000000")
    ).status_code == 404
    assert (await client.get("/api/products/not-a-uuid")).status_code == 422


async def test_search_name_and_description_case_insensitive(client, make_product):
    await make_product(name="Red Rose", description="soft petals")
    await make_product(name="Bunny", description="Amigurumi ROSE-scented")
    await make_product(name="Cup", description=None)
    assert sorted(await names(client, search="rose")) == ["Bunny", "Red Rose"]
    assert await names(client, search="  PETALS ") == ["Red Rose"]


@pytest.mark.parametrize("term", ["%", "_", "\\"])
async def test_search_wildcards_are_literal(client, make_product, term):
    await make_product(name="Plain")
    assert await names(client, search=term) == []


async def test_filters(client, admin_h, make_product, category_id):
    other = (
        await client.post("/api/admin/categories", headers=admin_h, json={"name": "Keys"})
    ).json()
    await make_product(name="A", price_paisa=100, is_featured=True)
    await make_product(name="B", price_paisa=500, category_id=other["category_id"])
    await make_product(
        name="C",
        price_paisa=900,
        availability_type="MADE_TO_ORDER",
        stock_quantity=0,
        max_active_units=3,
    )
    assert await names(client, category_id=other["category_id"]) == ["B"]
    assert await names(client, featured="true") == ["A"]
    assert await names(client, availability="MADE_TO_ORDER") == ["C"]
    assert sorted(await names(client, min_price=200, max_price=900)) == ["B", "C"]
    assert await names(client, min_price=1000) == []


async def test_availability_rules(client, make_product):
    await make_product(name="InStock", stock_quantity=2)
    await make_product(name="SoldOut", stock_quantity=0)
    await make_product(
        name="MtoOpen", availability_type="MADE_TO_ORDER", stock_quantity=0, max_active_units=2
    )
    await make_product(
        name="MtoFull", availability_type="MADE_TO_ORDER", stock_quantity=0, max_active_units=0
    )
    items = (await client.get("/api/products", params={"page_size": 50})).json()["items"]
    flags = {p["name"]: p["is_available"] for p in items}
    assert flags == {"InStock": True, "SoldOut": False, "MtoOpen": True, "MtoFull": False}
    assert sorted(await names(client, available_only="true")) == ["InStock", "MtoOpen"]


async def test_sorting(client, make_product):
    await make_product(name="banana", price_paisa=300)
    await make_product(name="Apple", price_paisa=900)
    await make_product(name="cherry", price_paisa=100)
    assert await names(client, sort="price_asc") == ["cherry", "banana", "Apple"]
    assert await names(client, sort="price_desc") == ["Apple", "banana", "cherry"]
    assert await names(client, sort="name") == ["Apple", "banana", "cherry"]
    assert await names(client, sort="newest") == ["cherry", "Apple", "banana"]
    assert (await client.get("/api/products", params={"sort": "bogus"})).status_code == 422


async def test_pagination(client, make_product):
    for i in range(5):
        await make_product(name=f"P{i}", price_paisa=i)
    r = (
        await client.get("/api/products", params={"page_size": 2, "page": 2, "sort": "price_asc"})
    ).json()
    assert (r["total"], r["page"], r["page_size"]) == (5, 2, 2)
    assert [p["name"] for p in r["items"]] == ["P2", "P3"]
    last = (
        await client.get("/api/products", params={"page_size": 2, "page": 3, "sort": "price_asc"})
    ).json()
    assert [p["name"] for p in last["items"]] == ["P4"]
    assert (await client.get("/api/products", params={"page_size": 51})).status_code == 422
    assert (await client.get("/api/products", params={"page": 0})).status_code == 422
    assert (await client.get("/api/products", params={"min_price": -1})).status_code == 422


async def test_listing_returns_first_image_by_sort_order(client, admin_h, make_product):
    p = await make_product()
    pid = p["product_id"]
    for order, name in ((5, "b"), (1, "a")):
        path = f"products/{pid}/{name * 32}.jpg"
        await client.post(
            f"/api/admin/products/{pid}/images",
            headers=admin_h,
            json={"storage_path": path, "sort_order": order, "alt_text": name},
        )
    item = (await client.get("/api/products")).json()["items"][0]
    assert item["image"]["alt_text"] == "a"
    assert item["image"]["url"].endswith(
        f"/object/public/product-images/products/{pid}/{'a' * 32}.jpg"
    )
    detail = (await client.get(f"/api/products/{pid}")).json()
    assert [i["alt_text"] for i in detail["images"]] == ["a", "b"]
