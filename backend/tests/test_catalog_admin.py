import uuid

import pytest
from sqlalchemy import text

from tests.conftest import FakeStorage, auth

ADMIN_ROUTES = [
    ("GET", "/api/admin/products"),
    ("POST", "/api/admin/products"),
    ("GET", f"/api/admin/products/{uuid.uuid4()}"),
    ("PATCH", f"/api/admin/products/{uuid.uuid4()}"),
    ("DELETE", f"/api/admin/products/{uuid.uuid4()}"),
    ("POST", "/api/admin/categories"),
    ("PATCH", f"/api/admin/categories/{uuid.uuid4()}"),
    ("DELETE", f"/api/admin/categories/{uuid.uuid4()}"),
    ("POST", f"/api/admin/products/{uuid.uuid4()}/images/upload-url"),
    ("POST", f"/api/admin/products/{uuid.uuid4()}/images"),
    ("PATCH", f"/api/admin/products/{uuid.uuid4()}/images/{uuid.uuid4()}"),
    ("DELETE", f"/api/admin/products/{uuid.uuid4()}/images/{uuid.uuid4()}"),
]


@pytest.mark.parametrize(("method", "url"), ADMIN_ROUTES)
async def test_admin_routes_reject_anonymous_and_customers(client, customer_h, method, url):
    assert (await client.request(method, url, json={})).status_code == 401
    assert (await client.request(method, url, headers=customer_h, json={})).status_code == 403


# ---- products ----------------------------------------------------------------------------


async def test_create_defaults_to_hidden_and_admin_sees_it(client, admin_h, category_id):
    r = await client.post(
        "/api/admin/products",
        headers=admin_h,
        json={
            "category_id": category_id,
            "name": "  Draft  ",
            "price_paisa": 100,
            "availability_type": "MADE_TO_ORDER",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Draft"
    assert body["is_visible"] is False and body["is_featured"] is False
    assert body["stock_quantity"] == 0 and body["max_active_units"] == 0
    assert (await client.get("/api/products")).json()["total"] == 0
    admin_list = (await client.get("/api/admin/products", headers=admin_h)).json()
    assert admin_list["total"] == 1


@pytest.mark.parametrize(
    "override",
    [
        {"price_paisa": -1},
        {"price_paisa": 12.5},
        {"price_paisa": 10**12},
        {"stock_quantity": -1},
        {"max_active_units": -1},
        {"name": "   "},
        {"availability_type": "SOMETIMES"},
        {"unknown_field": 1},
    ],
)
async def test_create_validation(client, admin_h, category_id, override):
    body = {
        "category_id": category_id,
        "name": "X",
        "price_paisa": 1,
        "availability_type": "READY_TO_SHIP",
    } | override
    assert (await client.post("/api/admin/products", headers=admin_h, json=body)).status_code == 422


async def test_create_with_unknown_category_is_422(client, admin_h):
    body = {
        "category_id": str(uuid.uuid4()),
        "name": "X",
        "price_paisa": 1,
        "availability_type": "READY_TO_SHIP",
    }
    assert (await client.post("/api/admin/products", headers=admin_h, json=body)).status_code == 422


async def test_patch_visibility_featured_and_fields(client, admin_h, make_product):
    p = await make_product(is_visible=False)
    url = f"/api/admin/products/{p['product_id']}"
    assert (await client.get(f"/api/products/{p['product_id']}")).status_code == 404
    r = await client.patch(
        url, headers=admin_h, json={"is_visible": True, "is_featured": True, "price_paisa": 999}
    )
    assert r.status_code == 200
    assert r.json()["price_paisa"] == 999
    assert (await client.get(f"/api/products/{p['product_id']}")).status_code == 200
    r = await client.patch(url, headers=admin_h, json={"is_visible": False})
    assert (await client.get(f"/api/products/{p['product_id']}")).status_code == 404
    assert r.json()["updated_at"] >= p["updated_at"]


async def test_patch_rules(client, admin_h, make_product):
    p = await make_product()
    url = f"/api/admin/products/{p['product_id']}"
    assert (await client.patch(url, headers=admin_h, json={"description": None})).json()[
        "description"
    ] is None
    for bad in ({"name": None}, {"price_paisa": None}, {"stock_quantity": -3}, {"product_id": "x"}):
        assert (await client.patch(url, headers=admin_h, json=bad)).status_code == 422, bad
    assert (
        await client.patch(url, headers=admin_h, json={"category_id": str(uuid.uuid4())})
    ).status_code == 422
    missing = f"/api/admin/products/{uuid.uuid4()}"
    assert (await client.patch(missing, headers=admin_h, json={"name": "x"})).status_code == 404


async def test_database_rejects_negative_values_even_without_the_api(db_engine, category_id):
    async with db_engine.begin() as conn:
        with pytest.raises(Exception, match="ck_products_stock_nonneg"):
            await conn.execute(
                text(
                    "INSERT INTO products (product_id, category_id, name, price_paisa,"
                    " availability_type, stock_quantity) VALUES (gen_random_uuid(), :c, 'x', 1,"
                    " 'READY_TO_SHIP', -1)"
                ),
                {"c": uuid.UUID(category_id)},
            )


# ---- categories --------------------------------------------------------------------------


async def test_category_crud_and_rules(client, admin_h, make_product, category_id):
    dup = await client.post("/api/admin/categories", headers=admin_h, json={"name": "Flowers"})
    assert dup.status_code == 409
    r = await client.patch(
        f"/api/admin/categories/{category_id}", headers=admin_h, json={"name": "Blooms"}
    )
    assert r.json()["name"] == "Blooms"
    await make_product()
    in_use = await client.delete(f"/api/admin/categories/{category_id}", headers=admin_h)
    assert in_use.status_code == 409  # business-rules §4
    empty = (
        await client.post("/api/admin/categories", headers=admin_h, json={"name": "Empty"})
    ).json()
    assert (
        await client.delete(f"/api/admin/categories/{empty['category_id']}", headers=admin_h)
    ).status_code == 204
    missing = await client.delete(f"/api/admin/categories/{uuid.uuid4()}", headers=admin_h)
    assert missing.status_code == 404
    assert (
        await client.post("/api/admin/categories", headers=admin_h, json={"name": "  "})
    ).status_code == 422


# ---- images ------------------------------------------------------------------------------


async def test_upload_url_uses_server_generated_path(client, admin_h, make_product):
    p = await make_product()
    url = f"/api/admin/products/{p['product_id']}/images/upload-url"
    r = await client.post(url, headers=admin_h, json={"content_type": "image/png"})
    assert r.status_code == 200
    body = r.json()
    assert body["storage_path"].startswith(f"products/{p['product_id']}/")
    assert body["storage_path"].endswith(".png")
    assert body["bucket"] == "product-images"
    assert body["token"] == "tok"


@pytest.mark.parametrize("ctype", ["image/gif", "image/svg+xml", "text/html", "application/pdf"])
async def test_upload_url_rejects_other_types(client, admin_h, make_product, ctype):
    p = await make_product()
    url = f"/api/admin/products/{p['product_id']}/images/upload-url"
    assert (
        await client.post(url, headers=admin_h, json={"content_type": ctype})
    ).status_code == 422


async def test_upload_url_unknown_product_and_unconfigured_storage(client, admin_h, make_product):
    missing = f"/api/admin/products/{uuid.uuid4()}/images/upload-url"
    assert (
        await client.post(missing, headers=admin_h, json={"content_type": "image/png"})
    ).status_code == 404

    from app.core.storage import get_storage
    from app.main import create_app  # noqa: F401

    client._transport.app.dependency_overrides[get_storage] = lambda: FakeStorage(configured=False)
    p = await make_product()
    url = f"/api/admin/products/{p['product_id']}/images/upload-url"
    r = await client.post(url, headers=admin_h, json={"content_type": "image/png"})
    assert r.status_code == 503


async def test_register_image_validates_path(client, admin_h, make_product):
    p, other = await make_product(), await make_product(name="Other")
    pid = p["product_id"]
    url = f"/api/admin/products/{pid}/images"
    good = f"products/{pid}/{'a' * 32}.webp"
    assert (await client.post(url, headers=admin_h, json={"storage_path": good})).status_code == 201
    bad_paths = [
        f"products/{other['product_id']}/{'a' * 32}.jpg",  # another product's folder
        f"products/{pid}/../../x.jpg",
        f"products/{pid}/{'a' * 32}.svg",
        f"products/{pid}/{'a' * 32}.jpg.exe",
        "https://evil.example/x.jpg",
        f"/products/{pid}/{'a' * 32}.jpg",
    ]
    for path in bad_paths:
        r = await client.post(url, headers=admin_h, json={"storage_path": path})
        assert r.status_code == 422, path


async def test_image_update_delete_and_scoping(client, admin_h, make_product, storage):
    p, other = await make_product(), await make_product(name="Other")
    pid = p["product_id"]
    path = f"products/{pid}/{'c' * 32}.png"
    img = (
        await client.post(
            f"/api/admin/products/{pid}/images", headers=admin_h, json={"storage_path": path}
        )
    ).json()
    url = f"/api/admin/products/{pid}/images/{img['image_id']}"
    r = await client.patch(url, headers=admin_h, json={"alt_text": "Sunny", "sort_order": 3})
    assert (r.json()["alt_text"], r.json()["sort_order"]) == ("Sunny", 3)
    wrong = f"/api/admin/products/{other['product_id']}/images/{img['image_id']}"
    assert (await client.patch(wrong, headers=admin_h, json={"alt_text": "x"})).status_code == 404
    assert (await client.delete(wrong, headers=admin_h)).status_code == 404
    assert (await client.delete(url, headers=admin_h)).status_code == 204
    assert storage.deleted == [path]
    detail = (await client.get(f"/api/admin/products/{pid}", headers=admin_h)).json()
    assert detail["images"] == []


async def test_delete_product_removes_images_and_storage_files(
    client, admin_h, make_product, storage, db_engine
):
    p = await make_product()
    pid = p["product_id"]
    paths = [f"products/{pid}/{c * 32}.jpg" for c in "de"]
    for path in paths:
        await client.post(
            f"/api/admin/products/{pid}/images", headers=admin_h, json={"storage_path": path}
        )
    assert (await client.delete(f"/api/admin/products/{pid}", headers=admin_h)).status_code == 204
    assert sorted(storage.deleted) == sorted(paths)
    assert (await client.get(f"/api/admin/products/{pid}", headers=admin_h)).status_code == 404
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM product_images"))).scalar() == 0
    assert (await client.delete(f"/api/admin/products/{pid}", headers=admin_h)).status_code == 404


async def test_admin_list_includes_hidden_and_filters(client, admin_h, make_product):
    await make_product(name="Shown")
    await make_product(name="Hidden", is_visible=False)
    r = (await client.get("/api/admin/products", headers=admin_h)).json()
    assert r["total"] == 2
    admin_item = r["items"][0]
    assert {"stock_quantity", "max_active_units", "is_visible"} <= admin_item.keys()
    found = (
        await client.get("/api/admin/products", headers=admin_h, params={"search": "hid"})
    ).json()
    assert [p["name"] for p in found["items"]] == ["Hidden"]


def test_helper_import():
    assert auth("x") == {"Authorization": "Bearer x"}
