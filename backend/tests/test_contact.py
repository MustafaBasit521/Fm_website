import uuid

import pytest

from app.core.rate_limit import limiter

URL = "/api/contact"
ADMIN = "/api/admin/messages"
BODY = {"name": "Sara", "email": "Sara@Example.com", "message": "Do you ship to Islamabad?"}


async def send(client, **over):
    r = await client.post(URL, json=BODY | over)
    assert r.status_code == 201, r.text
    return r


async def all_messages(client, admin_h, **params):
    return (await client.get(ADMIN, headers=admin_h, params=params)).json()


async def test_anyone_can_send_a_message(client, admin_h):
    r = await send(client)
    assert r.json() == {"received": True}
    page = await all_messages(client, admin_h)
    m = page["items"][0]
    assert (m["name"], m["email"], m["status"]) == ("Sara", "sara@example.com", "NEW")
    assert m["phone"] is None and m["whatsapp_number"] is None


async def test_phone_or_whatsapp_alone_is_enough_to_reply(client, admin_h):
    await send(client, email=None, whatsapp_number="0300 1234567")
    await send(client, email=None, phone="+92 42 1111111")
    assert (await all_messages(client, admin_h))["total"] == 2


@pytest.mark.parametrize(
    "over",
    [
        {"name": " "},
        {"message": " "},
        {"message": "x" * 3001},
        {"email": "not-an-email"},
        {"email": None},  # nothing left to reply to
        {"phone": "abc"},
        {"whatsapp_number": "x" * 21},
        {"status": "REPLIED"},
        {"unknown": 1},
    ],
)
async def test_validation(client, over):
    assert (await client.post(URL, json=BODY | over)).status_code == 422


async def test_messages_are_rate_limited(client):
    limiter.enabled = True
    for _ in range(5):
        assert (await client.post(URL, json=BODY)).status_code == 201
    r = await client.post(URL, json=BODY)
    assert r.status_code == 429 and "retry-after" in r.headers


async def test_the_shop_is_alerted_by_email(client, emails, db_engine):
    from sqlalchemy import text

    async with db_engine.begin() as conn:
        await conn.execute(text("UPDATE business_settings SET email = 'shop@example.com'"))
    await send(client, phone="03001234567")
    alert = emails.to("shop@example.com")
    assert len(alert) == 1 and "Do you ship to Islamabad?" in alert[0].body
    assert "sara@example.com" in alert[0].body and "03001234567" in alert[0].body


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


async def test_admin_manages_message_statuses(client, admin_h):
    await send(client, name="First")
    await send(client, name="Second", message="Prices please")
    page = await all_messages(client, admin_h)
    first = next(m for m in page["items"] if m["name"] == "First")
    got = await client.get(f"{ADMIN}/{first['message_id']}", headers=admin_h)
    assert got.status_code == 200 and got.json()["status"] == "NEW"  # reading does not change it

    for status in ("READ", "REPLIED", "ARCHIVED", "NEW"):
        r = await client.post(
            f"{ADMIN}/{first['message_id']}/status", headers=admin_h, json={"status": status}
        )
        assert r.status_code == 200 and r.json()["status"] == status
    await client.post(
        f"{ADMIN}/{first['message_id']}/status", headers=admin_h, json={"status": "READ"}
    )
    assert (await all_messages(client, admin_h, status="NEW"))["total"] == 1
    assert (await all_messages(client, admin_h, status="READ"))["total"] == 1
    assert (await all_messages(client, admin_h, search="prices"))["total"] == 1
    assert (await all_messages(client, admin_h, search="%"))["total"] == 0
    assert (await all_messages(client, admin_h, page=2, page_size=1))["items"] != []
    assert (await all_messages(client, admin_h, status="BOGUS")) == {
        "detail": (await all_messages(client, admin_h, status="BOGUS"))["detail"]
    }


async def test_unknown_message_and_bad_status(client, admin_h):
    assert (await client.get(f"{ADMIN}/{uuid.uuid4()}", headers=admin_h)).status_code == 404
    r = await client.post(
        f"{ADMIN}/{uuid.uuid4()}/status", headers=admin_h, json={"status": "READ"}
    )
    assert r.status_code == 404
    r = await client.post(
        f"{ADMIN}/{uuid.uuid4()}/status", headers=admin_h, json={"status": "NOPE"}
    )
    assert r.status_code == 422
