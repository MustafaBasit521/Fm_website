import uuid

from tests.conftest import auth


async def test_first_request_creates_customer_from_token(client, make_token):
    uid = uuid.uuid4()
    r = await client.get("/api/customers/me", headers=auth(make_token(sub=uid)))
    assert r.status_code == 200
    body = r.json()
    assert body["customer_id"] == str(uid)
    assert body["name"] == "Ayesha"
    assert body["email"] == "ayesha@example.com"  # lower-cased
    assert body["phone"] is None
    assert body["subscribed_to_updates"] is True  # business-rules §7
    assert "password" not in body


async def test_second_request_returns_same_row(client, make_token):
    token = make_token()
    a = (await client.get("/api/customers/me", headers=auth(token))).json()
    b = (await client.get("/api/customers/me", headers=auth(token))).json()
    assert a == b


async def test_name_falls_back_to_email_local_part(client, make_token):
    r = await client.get("/api/customers/me", headers=auth(make_token(name=None)))
    assert r.json()["name"] == "ayesha"


async def test_token_without_email_is_rejected(client, make_token):
    r = await client.get("/api/customers/me", headers=auth(make_token(email=None)))
    assert r.status_code == 400


async def test_patch_updates_profile(client, make_token):
    token = make_token()
    r = await client.patch(
        "/api/customers/me",
        headers=auth(token),
        json={"name": "  Ayesha Khan ", "phone": "+92 300 1234567", "subscribed_to_updates": False},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Ayesha Khan"
    assert r.json()["phone"] == "+92 300 1234567"
    assert r.json()["subscribed_to_updates"] is False
    again = await client.get("/api/customers/me", headers=auth(token))
    assert again.json()["name"] == "Ayesha Khan"


async def test_patch_empty_phone_clears_it(client, make_token):
    token = make_token()
    await client.patch("/api/customers/me", headers=auth(token), json={"phone": "03001234567"})
    r = await client.patch("/api/customers/me", headers=auth(token), json={"phone": ""})
    assert r.json()["phone"] is None


async def test_patch_validation(client, make_token):
    h = auth(make_token())
    assert (
        await client.patch("/api/customers/me", headers=h, json={"name": "  "})
    ).status_code == 422
    assert (
        await client.patch("/api/customers/me", headers=h, json={"phone": "abc"})
    ).status_code == 422
    assert (
        await client.patch("/api/customers/me", headers=h, json={"name": None})
    ).status_code == 422


async def test_patch_cannot_change_email_or_id(client, make_token):
    h = auth(make_token())
    for field in ("email", "customer_id", "created_at"):
        r = await client.patch("/api/customers/me", headers=h, json={field: "x"})
        assert r.status_code == 422, field


async def test_customers_are_isolated(client, make_token):
    a = make_token(email="a@example.com", name="A")
    b = make_token(email="b@example.com", name="B")
    await client.patch("/api/customers/me", headers=auth(a), json={"phone": "03001111111"})
    rb = await client.get("/api/customers/me", headers=auth(b))
    assert rb.json()["name"] == "B"
    assert rb.json()["phone"] is None


async def test_duplicate_email_for_different_user_is_409(client, make_token):
    await client.get("/api/customers/me", headers=auth(make_token(email="same@example.com")))
    r = await client.get("/api/customers/me", headers=auth(make_token(email="same@example.com")))
    assert r.status_code == 409


async def test_concurrent_first_requests_create_one_row(client, make_token):
    import asyncio

    token = make_token()
    results = await asyncio.gather(
        *[client.get("/api/customers/me", headers=auth(token)) for _ in range(8)]
    )
    assert [r.status_code for r in results] == [200] * 8
    assert len({r.json()["customer_id"] for r in results}) == 1
