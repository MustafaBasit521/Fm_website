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


OWNERS: dict[str, dict] = {}  # request id -> the registered customer's headers


async def submit(client, headers=None, **over):
    r = await client.post(URL, json=BODY | over, headers=headers)
    assert r.status_code == 201, r.text
    if headers:
        OWNERS[r.json()["custom_order_id"]] = headers
    return r.json()


async def move(client, admin_h, cid, status):
    if status == "ACCEPTED":
        owner = OWNERS.get(cid)
        if owner is None:  # a guest: the admin records the price agreed on WhatsApp
            return await client.post(
                f"{ADMIN}/{cid}/accept", headers=admin_h, json={"agreed_price_paisa": 100000}
            )
        # a registered customer: the shop proposes, the customer confirms
        await client.post(
            f"{ADMIN}/{cid}/propose-price", headers=admin_h, json={"price_paisa": 100000}
        )
        return await client.post(
            f"{URL}/{cid}/confirm-price", headers=owner, json={"price_paisa": 100000}
        )
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
        ("POST", f"{ADMIN}/{uuid.uuid4()}/accept"),
        ("POST", f"{ADMIN}/{uuid.uuid4()}/propose-price"),
        ("GET", f"{ADMIN}/{uuid.uuid4()}/messages"),
        ("POST", f"{ADMIN}/{uuid.uuid4()}/messages"),
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
    assert [n["type"] for n in notes] == ["CUSTOM_ORDER_UPDATE"] * 4  # incl. the price proposal
    assert "accepted" in notes[0]["message"]
    assert emails.to("alice@example.com")[-1].subject == "Your custom order was accepted"


async def test_guests_get_no_customer_email_because_none_is_collected(
    client, admin_h, emails, db_engine
):
    co = await submit(client)
    await move(client, admin_h, co["custom_order_id"], "IN_DISCUSSION")
    assert emails.sent == []  # no shop email configured and no customer email exists
    async with db_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM notifications"))).scalar() == 0


async def test_admin_list_signs_pictures_concurrently_not_one_by_one(client, admin_h, storage):
    import asyncio
    import time

    for i in range(6):
        await submit(client, reference_image_path=f"custom-orders/{str(i) * 32}.jpg")
    active = {"now": 0, "peak": 0}

    async def slow_sign(path, bucket, expires_in=3600):
        active["now"] += 1
        active["peak"] = max(active["peak"], active["now"])
        await asyncio.sleep(0.2)
        active["now"] -= 1
        return f"https://down.example/{bucket}/{path}"

    storage.create_signed_download = slow_sign
    started = time.perf_counter()
    r = await client.get(ADMIN, headers=admin_h)
    elapsed = time.perf_counter() - started
    assert r.status_code == 200 and all(i["reference_image_url"] for i in r.json()["items"])
    assert active["peak"] > 1  # overlapped
    assert elapsed < 0.2 * 6  # six sequential calls would take 1.2 s


# ---- the discussion and the agreed price ----------------------------------------------------


async def talk(client, headers, cid, body, *, admin=False):
    url = f"{ADMIN}/{cid}/messages" if admin else f"{URL}/{cid}/messages"
    return await client.post(url, headers=headers, json={"body": body})


async def test_customer_and_admin_talk_in_a_thread_that_only_they_can_see(
    client, admin_h, alice, bob
):
    cid = (await submit(client, headers=alice))["custom_order_id"]
    first = await talk(client, alice, cid, "  I would like it in blush pink  ")
    assert first.status_code == 201
    assert (
        first.json()["sender"] == "CUSTOMER"
        and first.json()["body"] == "I would like it in blush pink"
    )
    reply = await talk(client, admin_h, cid, "Sure! Rs 2,000 works for us.", admin=True)
    assert reply.status_code == 201 and reply.json()["sender"] == "ADMIN"

    mine = (await client.get(f"{URL}/{cid}/messages", headers=alice)).json()
    assert [(m["sender"], m["body"]) for m in mine] == [
        ("CUSTOMER", "I would like it in blush pink"),
        ("ADMIN", "Sure! Rs 2,000 works for us."),
    ]
    seen = (await client.get(f"{ADMIN}/{cid}/messages", headers=admin_h)).json()
    assert seen == mine
    # nobody else can read or write
    assert (await client.get(f"{URL}/{cid}/messages", headers=bob)).status_code == 404
    assert (await talk(client, bob, cid, "hi")).status_code == 404
    assert (await client.get(f"{URL}/{cid}/messages")).status_code == 401
    assert (await talk(client, None, cid, "hi")).status_code == 401


@pytest.mark.parametrize("body", ["", "   ", "x" * 2001])
async def test_messages_must_have_sensible_text(client, alice, body):
    cid = (await submit(client, headers=alice))["custom_order_id"]
    assert (await talk(client, alice, cid, body)).status_code == 422


async def test_a_guest_request_has_no_discussion(client, admin_h):
    cid = (await submit(client))["custom_order_id"]  # guests have no account to answer in
    r = await talk(client, admin_h, cid, "Hello", admin=True)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NO_DISCUSSION"
    assert (await client.get(f"{ADMIN}/{cid}/messages", headers=admin_h)).json() == []


async def test_the_discussion_closes_when_the_request_is_finished(client, admin_h, alice):
    cid = (await submit(client, headers=alice))["custom_order_id"]
    for status in ("IN_DISCUSSION", "ACCEPTED", "IN_PROGRESS"):
        await move(client, admin_h, cid, status)
        assert (await talk(client, alice, cid, f"still open in {status}")).status_code == 201
    await move(client, admin_h, cid, "COMPLETED")
    for headers, admin in ((alice, False), (admin_h, True)):
        r = await talk(client, headers, cid, "too late", admin=admin)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "DISCUSSION_CLOSED"
    # what was said stays readable
    assert len((await client.get(f"{URL}/{cid}/messages", headers=alice)).json()) == 3


async def test_the_shop_proposes_a_price_and_only_the_customer_can_accept_it(
    client, admin_h, alice, bob, emails
):
    cid = (await submit(client, headers=alice, budget_paisa=150000))["custom_order_id"]
    propose = f"{ADMIN}/{cid}/propose-price"
    confirm = f"{URL}/{cid}/confirm-price"
    # a new request must be discussed first
    early = await client.post(propose, headers=admin_h, json={"price_paisa": 200000})
    assert early.status_code == 409 and early.json()["detail"]["code"] == "INVALID_TRANSITION"
    await move(client, admin_h, cid, "IN_DISCUSSION")
    assert (
        await client.post(propose, headers=admin_h, json={"price_paisa": -1})
    ).status_code == 422
    r = await client.post(propose, headers=admin_h, json={"price_paisa": 200000})
    assert r.status_code == 200
    assert (
        r.json()["status"],
        r.json()["proposed_price_paisa"],
        r.json()["agreed_price_paisa"],
    ) == (
        "IN_DISCUSSION",
        200000,
        None,  # nothing is agreed until the customer confirms
    )
    assert "Rs 2,000" in emails.to("alice@example.com")[-1].body

    # the customer sees the proposal; nobody else can confirm it; the admin cannot force it
    mine = (await client.get(f"{URL}/{cid}", headers=alice)).json()
    assert mine["proposed_price_paisa"] == 200000 and mine["agreed_price_paisa"] is None
    assert (
        await client.post(confirm, headers=bob, json={"price_paisa": 200000})
    ).status_code == 404
    assert (await client.post(confirm, json={"price_paisa": 200000})).status_code == 401
    forced = await client.post(
        f"{ADMIN}/{cid}/accept", headers=admin_h, json={"agreed_price_paisa": 200000}
    )
    assert forced.status_code == 409 and forced.json()["detail"]["code"] == "CUSTOMER_MUST_CONFIRM"

    # a price changed in the meantime is never accepted by mistake
    await client.post(propose, headers=admin_h, json={"price_paisa": 250000})
    stale = await client.post(confirm, headers=alice, json={"price_paisa": 200000})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "PRICE_CHANGED"

    ok = await client.post(confirm, headers=alice, json={"price_paisa": 250000})
    assert ok.status_code == 200
    assert (ok.json()["status"], ok.json()["agreed_price_paisa"], ok.json()["budget_paisa"]) == (
        "ACCEPTED",
        250000,
        150000,  # what the customer offered is kept as it was
    )
    notes = (await client.get("/api/customers/me/notifications", headers=alice)).json()["items"]
    assert "Rs 2,500" in notes[0]["message"]
    again = await client.post(propose, headers=admin_h, json={"price_paisa": 300000})
    assert again.status_code == 409  # final once accepted
    assert (
        await client.post(confirm, headers=alice, json={"price_paisa": 250000})
    ).status_code == 409


async def test_confirming_needs_a_proposal(client, admin_h, alice):
    cid = (await submit(client, headers=alice))["custom_order_id"]
    await move(client, admin_h, cid, "IN_DISCUSSION")
    r = await client.post(f"{URL}/{cid}/confirm-price", headers=alice, json={"price_paisa": 100})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NO_PROPOSAL"


async def test_the_shop_is_told_when_the_customer_confirms(
    client, admin_h, alice, emails, db_engine
):
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = 'shop@example.com'"))
    cid = (await submit(client, headers=alice))["custom_order_id"]
    await move(client, admin_h, cid, "IN_DISCUSSION")
    emails.sent.clear()
    await move(client, admin_h, cid, "ACCEPTED")
    alert = [m for m in emails.to("shop@example.com") if "accepted" in m.subject.lower()]
    assert len(alert) == 1 and "Rs 1,000" in alert[0].body


async def test_guest_requests_are_accepted_by_the_admin_at_the_price_agreed_on_whatsapp(
    client, admin_h
):
    cid = (await submit(client))["custom_order_id"]
    url = f"{ADMIN}/{cid}/accept"
    early = await client.post(url, headers=admin_h, json={"agreed_price_paisa": 200000})
    assert early.status_code == 409 and early.json()["detail"]["code"] == "INVALID_TRANSITION"
    await move(client, admin_h, cid, "IN_DISCUSSION")
    no_proposal = await client.post(
        f"{ADMIN}/{cid}/propose-price", headers=admin_h, json={"price_paisa": 1}
    )
    assert (
        no_proposal.status_code == 409 and no_proposal.json()["detail"]["code"] == "NO_DISCUSSION"
    )
    r = await client.post(url, headers=admin_h, json={"agreed_price_paisa": 200000})
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["agreed_price_paisa"]) == ("ACCEPTED", 200000)


async def test_a_new_message_tells_the_other_side(client, admin_h, alice, emails, db_engine):
    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = 'shop@example.com'"))
    cid = (await submit(client, headers=alice))["custom_order_id"]
    emails.sent.clear()
    await talk(client, alice, cid, "Can it be ready by Friday?")
    alert = emails.to("shop@example.com")
    assert len(alert) == 1 and "Friday" in alert[0].body

    emails.sent.clear()
    await talk(client, admin_h, cid, "Yes, Friday is fine.", admin=True)
    note = emails.to("alice@example.com")
    assert len(note) == 1 and "Friday is fine" in note[0].body
    assert f"/custom-orders/{cid}" in note[0].body
    notes = (await client.get("/api/customers/me/notifications", headers=alice)).json()["items"]
    assert notes[0]["title"] == "New message about your custom order"
    assert emails.to("shop@example.com") == []  # the shop is not alerted about its own reply


async def test_writing_to_the_shop_is_rate_limited(client, alice):
    from app.core.rate_limit import limiter

    cid = (await submit(client, headers=alice))["custom_order_id"]
    limiter.enabled = True
    for i in range(30):
        assert (await talk(client, alice, cid, f"message {i}")).status_code == 201
    assert (await talk(client, alice, cid, "one too many")).status_code == 429


async def test_the_plain_status_route_cannot_accept_without_a_price(client, admin_h):
    cid = (await submit(client))["custom_order_id"]
    await move(client, admin_h, cid, "IN_DISCUSSION")
    r = await client.post(f"{ADMIN}/{cid}/status", headers=admin_h, json={"status": "ACCEPTED"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "USE_ACCEPT"
