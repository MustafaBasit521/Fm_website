import uuid

import pytest

ADMIN = "/api/admin/gallery"
PATH = lambda n="a": f"gallery/{n * 32}.jpg"  # noqa: E731


async def make_image(client, admin_h, **over):
    body = {"storage_path": PATH(), "image_type": "SHOP", "is_visible": True} | over
    r = await client.post(ADMIN, headers=admin_h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", ADMIN),
        ("POST", ADMIN),
        ("POST", f"{ADMIN}/upload-url"),
        ("PATCH", f"{ADMIN}/{uuid.uuid4()}"),
        ("DELETE", f"{ADMIN}/{uuid.uuid4()}"),
    ],
)
async def test_gallery_admin_routes_need_the_admin_role(client, customer_h, method, url):
    assert (await client.request(method, url, json={})).status_code == 401
    assert (await client.request(method, url, headers=customer_h, json={})).status_code == 403


async def test_upload_url_uses_server_path_in_the_gallery_bucket(client, admin_h, storage):
    r = await client.post(
        f"{ADMIN}/upload-url", headers=admin_h, json={"content_type": "image/webp"}
    )
    assert r.status_code == 200
    body = r.json()
    import re

    assert re.fullmatch(r"gallery/[0-9a-f]{32}\.webp", body["storage_path"])
    assert body["bucket"] == "gallery-images"
    assert storage.uploads == [("gallery-images", body["storage_path"])]
    for bad in ("image/gif", "image/svg+xml", "text/html"):
        r = await client.post(f"{ADMIN}/upload-url", headers=admin_h, json={"content_type": bad})
        assert r.status_code == 422


async def test_new_images_start_hidden_and_the_public_sees_only_visible_ones(client, admin_h):
    hidden = await make_image(client, admin_h, storage_path=PATH("a"), is_visible=False)
    shown = await make_image(
        client, admin_h, storage_path=PATH("b"), title=" Sunny ", description="d"
    )
    default = await client.post(
        ADMIN, headers=admin_h, json={"storage_path": PATH("c"), "image_type": "DESIGN"}
    )
    assert default.json()["is_visible"] is False
    public = (await client.get("/api/gallery")).json()
    assert [i["gallery_image_id"] for i in public["items"]] == [shown["gallery_image_id"]]
    assert public["items"][0]["title"] == "Sunny"
    assert "/object/public/gallery-images/gallery/" in public["items"][0]["url"]
    assert "is_visible" not in public["items"][0]
    admin_list = (await client.get(ADMIN, headers=admin_h)).json()
    assert admin_list["total"] == 3
    assert hidden["gallery_image_id"] in [i["gallery_image_id"] for i in admin_list["items"]]


async def test_filter_by_type_and_pagination(client, admin_h):
    await make_image(client, admin_h, storage_path=PATH("a"), image_type="SHOP")
    await make_image(client, admin_h, storage_path=PATH("b"), image_type="BEHIND_THE_SCENES")
    await make_image(client, admin_h, storage_path=PATH("c"), image_type="SHOP")
    shop = (await client.get("/api/gallery", params={"type": "SHOP"})).json()
    assert shop["total"] == 2
    assert (await client.get("/api/gallery", params={"type": "BEHIND_THE_SCENES"})).json()[
        "total"
    ] == 1
    p2 = (await client.get("/api/gallery", params={"page": 2, "page_size": 2})).json()
    assert (p2["total"], len(p2["items"])) == (3, 1)
    assert (await client.get("/api/gallery", params={"type": "NOPE"})).status_code == 422
    assert (await client.get("/api/gallery", params={"page_size": 51})).status_code == 422


@pytest.mark.parametrize(
    "path",
    [
        "products/" + "a" * 32 + ".jpg",
        "gallery/../x.jpg",
        "gallery/" + "a" * 32 + ".svg",
        "gallery/" + "a" * 32 + ".jpg.exe",
        "custom-orders/" + "a" * 32 + ".jpg",
        "https://evil.example/x.jpg",
    ],
)
async def test_registering_validates_the_storage_path(client, admin_h, path):
    r = await client.post(ADMIN, headers=admin_h, json={"storage_path": path, "image_type": "SHOP"})
    assert r.status_code == 422


async def test_update_and_delete(client, admin_h, storage):
    img = await make_image(client, admin_h, is_visible=False)
    url = f"{ADMIN}/{img['gallery_image_id']}"
    r = await client.patch(
        url, headers=admin_h, json={"is_visible": True, "title": "New", "image_type": "DESIGN"}
    )
    assert (r.json()["is_visible"], r.json()["title"], r.json()["image_type"]) == (
        True,
        "New",
        "DESIGN",
    )
    assert (await client.get("/api/gallery")).json()["total"] == 1
    for bad in (
        {"image_type": None},
        {"is_visible": None},
        {"image_type": "NOPE"},
        {"storage_path": "x"},
    ):
        assert (await client.patch(url, headers=admin_h, json=bad)).status_code == 422
    assert (
        await client.patch(f"{ADMIN}/{uuid.uuid4()}", headers=admin_h, json={"title": "x"})
    ).status_code == 404
    assert (await client.delete(url, headers=admin_h)).status_code == 204
    assert storage.deleted_in == [("gallery-images", PATH())]  # the file is removed too
    assert (await client.get("/api/gallery")).json()["total"] == 0
    assert (await client.delete(url, headers=admin_h)).status_code == 404
