import re
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from app.core.rate_limit import limiter
from tests.conftest import FakeStorage, auth

URL = "/api/custom-orders"
ADMIN = "/api/admin/custom-orders"
IMG = f"custom-orders/{'a' * 32}.jpg"
BODY = {
    "name": "Sara Ahmed",
    "whatsapp_number": "+92 300 1234567",
    "description": "A crochet jersey with a name on it",
}


@pytest.fixture
def alice(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="alice@example.com", name="Alice"))


@pytest.fixture
def bob(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="bob@example.com", name="Bob"))


async def submit(client, headers=None, **over):
    r = await client.post(URL, json=BODY | over, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def move(client, admin_h, cid, status):
    return await client.post(f"{ADMIN}/{cid}/status", headers=admin_h, json={"status": status})


# ---- submitting ----------------------------------------------------------------------------


async def test_a_guest_can_submit_a_custom_order(client, db_engine):
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    co = await submit(client, budget_paisa=250000, required_date=tomorrow, reference_image_path=IMG)
    assert co["status"] == "NEW"
    assert co["has_reference_image"] is True
    assert "reference_image_path" not in co and "customer_id" not in co  # nothing private leaks
    assert co["whatsapp_number"] == "+92 300 1234567" and co["required_date"] == tomorrow
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT customer_id FROM custom_orders"))).scalar() is None


async def test_minimal_submission_and_trimming(client):
    co = await submit(client, name="  Sara  ", description="  Hello  ")
    assert (co["name"], co["description"]) == ("Sara", "Hello")
    assert (co["budget_paisa"], co["required_date"], co["has_reference_image"]) == (
        None,
        None,
        False,
    )


@pytest.mark.parametrize(
    "over",
    [
        {"name": "  "},
        {"name": "x" * 101},
        {"whatsapp_number": ""},
        {"whatsapp_number": "abc"},
        {"description": " "},
        {"description": "x" * 3001},
        {"budget_paisa": -1},
        {"budget_paisa": 10**12},
        {"budget_paisa": 12.5},
        {"required_date": (date.today() - timedelta(days=1)).isoformat()},
        {"required_date": "not-a-date"},
        {"reference_image_path": "products/" + "a" * 32 + ".jpg"},
        {"reference_image_path": "custom-orders/../secret.jpg"},
        {"reference_image_path": "custom-orders/" + "a" * 32 + ".svg"},
        {"reference_image_path": "https://evil.example/x.jpg"},
        {"status": "COMPLETED"},
        {"customer_id": str(uuid.uuid4())},
    ],
)
async def test_validation(client, over):
    assert (await client.post(URL, json=BODY | over)).status_code == 422


async def test_today_is_an_acceptable_required_date(client):
    await submit(client, required_date=date.today().isoformat())


# ---- the private reference image -----------------------------------------------------------


async def test_upload_url_targets_the_private_bucket_and_needs_no_login(client, storage):
    r = await client.post(f"{URL}/upload-url", json={"content_type": "image/png"})
    assert r.status_code == 200
    body = r.json()
    assert re.fullmatch(r"custom-orders/[0-9a-f]{32}\.png", body["storage_path"])
    assert body["bucket"] == "custom-order-references"
    assert storage.uploads == [("custom-order-references", body["storage_path"])]
    for bad in ("image/gif", "image/svg+xml", "application/pdf"):
        assert (
            await client.post(f"{URL}/upload-url", json={"content_type": bad})
        ).status_code == 422


async def test_upload_url_is_unavailable_without_storage(client):
    from app.core.storage import get_storage

    client.app.dependency_overrides[get_storage] = lambda: FakeStorage(configured=False)
    r = await client.post(f"{URL}/upload-url", json={"content_type": "image/png"})
    assert r.status_code == 503


async def test_the_image_is_only_visible_to_the_admin_through_a_signed_link(client, admin_h):
    with_img = await submit(client, reference_image_path=IMG)
    without = await submit(client)
    got = (await client.get(f"{ADMIN}/{with_img['custom_order_id']}", headers=admin_h)).json()
    assert (
        got["reference_image_url"] == f"https://down.example/custom-order-references/{IMG}?sig=abc"
    )
    none = (await client.get(f"{ADMIN}/{without['custom_order_id']}", headers=admin_h)).json()
    assert none["reference_image_url"] is None
    assert "reference_image" not in (await client.get("/api/gallery")).text


# ---- rate limiting (business-rules §29) ----------------------------------------------------


async def test_guest_submissions_and_uploads_are_rate_limited(client):
    limiter.enabled = True
    for _ in range(5):
        assert (await client.post(URL, json=BODY)).status_code == 201
    blocked = await client.post(URL, json=BODY)
    assert blocked.status_code == 429 and "retry-after" in blocked.headers
    for _ in range(10):
        assert (
            await client.post(f"{URL}/upload-url", json={"content_type": "image/png"})
        ).status_code == 200
    assert (
        await client.post(f"{URL}/upload-url", json={"content_type": "image/png"})
    ).status_code == 429


# ---- registered customers ------------------------------------------------------------------


async def test_registered_customers_see_only_their_own_requests(client, alice, bob):
    mine = await submit(client, headers=alice)
    await submit(client, headers=bob)
    await submit(client)  # a guest request belongs to nobody
    listed = (await client.get(URL, headers=alice)).json()
    assert [c["custom_order_id"] for c in listed["items"]] == [mine["custom_order_id"]]
    assert (await client.get(f"{URL}/{mine['custom_order_id']}", headers=alice)).status_code == 200
    assert (await client.get(f"{URL}/{mine['custom_order_id']}", headers=bob)).status_code == 404
    assert (await client.get(f"{URL}/{uuid.uuid4()}", headers=alice)).status_code == 404
    assert (await client.get(URL)).status_code == 401
    assert (await client.get(URL, headers=alice, params={"page_size": 51})).status_code == 422


async def test_an_invalid_token_is_not_treated_as_a_guest(client, make_token):
    r = await client.post(URL, json=BODY, headers=auth(make_token(exp_offset=-10)))
    assert r.status_code == 401


async def test_customer_can_cancel_only_before_anything_is_agreed(client, admin_h, alice, bob):
    co = await submit(client, headers=alice)
    cid = co["custom_order_id"]
    assert (await client.post(f"{URL}/{cid}/cancel", headers=bob)).status_code == 404
    assert (await client.post(f"{URL}/{cid}/cancel")).status_code == 401
    await move(client, admin_h, cid, "IN_DISCUSSION")
    r = await client.post(f"{URL}/{cid}/cancel", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"
    again = await client.post(f"{URL}/{cid}/cancel", headers=alice)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "CANNOT_CANCEL"

    other = await submit(client, headers=alice)
    for status in ("IN_DISCUSSION", "ACCEPTED"):
        await move(client, admin_h, other["custom_order_id"], status)
    r = await client.post(f"{URL}/{other['custom_order_id']}/cancel", headers=alice)
    assert r.status_code == 409  # accepted: the customer must contact the shop


async def test_deleting_a_customer_keeps_their_custom_orders(client, alice, db_engine):
    await submit(client, headers=alice)
    async with db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM customers"))
        assert (await conn.execute(text("SELECT count(*) FROM custom_orders"))).scalar() == 1
        assert (await conn.execute(text("SELECT customer_id FROM custom_orders"))).scalar() is None


# ---- admin ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", ADMIN),
        ("GET", f"{ADMIN}/{uuid.uuid4()}"),
        ("POST", f"{ADMIN}/{uuid.uuid4()}/status"),
    ],
)
async def test_admin_routes_need_the_admin_role(client, customer_h, method, url):
    assert (await client.request(method, url, json={})).status_code == 401
    assert (await client.request(method, url, headers=customer_h, json={})).status_code == 403


async def test_admin_list_filter_search_and_pagination(client, admin_h):
    a = await submit(client, name="Zainab", whatsapp_number="0301 1111111")
    await submit(client, name="Omar", description="A giant octopus")
    await move(client, admin_h, a["custom_order_id"], "IN_DISCUSSION")
    assert (await client.get(ADMIN, headers=admin_h)).json()["total"] == 2
    assert (await client.get(ADMIN, headers=admin_h, params={"status": "NEW"})).json()["total"] == 1
    assert (await client.get(ADMIN, headers=admin_h, params={"search": "octopus"})).json()[
        "total"
    ] == 1
    assert (await client.get(ADMIN, headers=admin_h, params={"search": "1111111"})).json()[
        "total"
    ] == 1
    assert (await client.get(ADMIN, headers=admin_h, params={"search": "%"})).json()["total"] == 0
    p2 = (await client.get(ADMIN, headers=admin_h, params={"page": 2, "page_size": 1})).json()
    assert len(p2["items"]) == 1
    assert (await client.get(ADMIN, headers=admin_h, params={"status": "BOGUS"})).status_code == 422


async def test_full_lifecycle_and_final_states(client, admin_h):
    co = await submit(client)
    cid = co["custom_order_id"]
    for status in ("IN_DISCUSSION", "ACCEPTED", "IN_PROGRESS", "COMPLETED"):
        r = await move(client, admin_h, cid, status)
        assert r.status_code == 200 and r.json()["status"] == status, status
    for status in ("NEW", "IN_PROGRESS", "CANCELLED", "COMPLETED"):
        r = await move(client, admin_h, cid, status)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "INVALID_TRANSITION"
    assert (await move(client, admin_h, str(uuid.uuid4()), "ACCEPTED")).status_code == 404
    assert (await move(client, admin_h, cid, "NOPE")).status_code == 422


async def test_allowed_and_refused_transitions(client, admin_h):
    async def fresh():
        return (await submit(client))["custom_order_id"]

    # skipping steps is refused
    cid = await fresh()
    for status in ("ACCEPTED", "IN_PROGRESS", "COMPLETED"):
        assert (await move(client, admin_h, cid, status)).status_code == 409, status
    # declined / cancelled branches
    assert (await move(client, admin_h, cid, "DECLINED")).json()["status"] == "DECLINED"
    assert (await move(client, admin_h, cid, "IN_DISCUSSION")).status_code == 409  # final
    cid = await fresh()
    await move(client, admin_h, cid, "IN_DISCUSSION")
    assert (await move(client, admin_h, cid, "DECLINED")).status_code == 200
    cid = await fresh()
    for status in ("IN_DISCUSSION", "ACCEPTED", "IN_PROGRESS"):
        await move(client, admin_h, cid, status)
    assert (await move(client, admin_h, cid, "CANCELLED")).status_code == 200
    cid = await fresh()
    for status in ("IN_DISCUSSION", "ACCEPTED"):
        await move(client, admin_h, cid, status)
    assert (
        await move(client, admin_h, cid, "DECLINED")
    ).status_code == 409  # accepted: cancel instead


# ---- notifications and emails --------------------------------------------------------------


async def test_events_notify_the_customer_and_alert_the_shop(
    client, admin_h, alice, emails, db_engine
):
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = 'shop@example.com'"))
    co = await submit(client, headers=alice)
    assert [m.to for m in emails.sent] == ["alice@example.com", "shop@example.com"]
    assert "WhatsApp" in emails.to("shop@example.com")[0].body
    await move(client, admin_h, co["custom_order_id"], "IN_DISCUSSION")
    await move(client, admin_h, co["custom_order_id"], "ACCEPTED")
    notes = (await client.get("/api/customers/me/notifications", headers=alice)).json()["items"]
    assert [n["type"] for n in notes] == ["CUSTOM_ORDER_UPDATE"] * 3
    assert "accepted" in notes[0]["message"]
    assert emails.to("alice@example.com")[-1].subject == "Update on your custom order"


async def test_guests_get_no_customer_email_because_none_is_collected(
    client, admin_h, emails, db_engine
):
    co = await submit(client)
    await move(client, admin_h, co["custom_order_id"], "IN_DISCUSSION")
    assert emails.sent == []  # no shop email configured and no customer email exists
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM notifications"))).scalar() == 0
