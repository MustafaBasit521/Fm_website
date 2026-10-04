import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth

ADDR = {"house_no": "12-B", "city": "Lahore", "postal_code": "54000", "country": "Pakistan"}
URL = "/api/customers/me/addresses"


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
        ("POST", URL),
        ("PATCH", f"{URL}/{uuid.uuid4()}"),
        ("DELETE", f"{URL}/{uuid.uuid4()}"),
    ],
)
async def test_requires_authentication(client, method, url):
    assert (await client.request(method, url, json={})).status_code == 401


async def test_create_list_update_delete(client, alice):
    assert (await client.get(URL, headers=alice)).json() == []  # also creates the customer row
    r = await client.post(URL, headers=alice, json=ADDR | {"label": " Home ", "province": "Punjab"})
    assert r.status_code == 201
    a = r.json()
    assert a["label"] == "Home" and a["province"] == "Punjab" and a["street_number"] is None
    r = await client.post(URL, headers=alice, json=ADDR | {"house_no": "7", "label": "Office"})
    assert [x["label"] for x in (await client.get(URL, headers=alice)).json()] == ["Home", "Office"]

    r = await client.patch(
        f"{URL}/{a['address_id']}", headers=alice, json={"street_number": "St 4", "label": ""}
    )
    assert r.status_code == 200
    assert r.json()["street_number"] == "St 4"
    assert r.json()["label"] is None  # blank optional becomes NULL
    assert r.json()["house_no"] == "12-B"  # untouched

    assert (await client.delete(f"{URL}/{a['address_id']}", headers=alice)).status_code == 204
    assert len((await client.get(URL, headers=alice)).json()) == 1
    assert (await client.delete(f"{URL}/{a['address_id']}", headers=alice)).status_code == 404


async def test_first_write_creates_customer_row(client, alice):
    """An address can be saved as the very first call (FK to customers must be satisfied)."""
    assert (await client.post(URL, headers=alice, json=ADDR)).status_code == 201
    assert (await client.get("/api/customers/me", headers=alice)).json()["name"] == "Alice"


@pytest.mark.parametrize("missing", ["house_no", "city", "postal_code", "country"])
async def test_required_fields(client, alice, missing):
    body = {k: v for k, v in ADDR.items() if k != missing}
    assert (await client.post(URL, headers=alice, json=body)).status_code == 422
    assert (await client.post(URL, headers=alice, json=ADDR | {missing: "   "})).status_code == 422


async def test_validation_limits_and_unknown_fields(client, alice):
    assert (
        await client.post(URL, headers=alice, json=ADDR | {"city": "x" * 101})
    ).status_code == 422
    assert (
        await client.post(URL, headers=alice, json=ADDR | {"customer_id": str(uuid.uuid4())})
    ).status_code == 422
    assert (
        await client.post(URL, headers=alice, json=ADDR | {"address_id": str(uuid.uuid4())})
    ).status_code == 422


async def test_patch_rejects_nulling_required_fields(client, alice):
    a = (await client.post(URL, headers=alice, json=ADDR)).json()
    for field in ADDR:
        r = await client.patch(f"{URL}/{a['address_id']}", headers=alice, json={field: None})
        assert r.status_code == 422, field


async def test_saved_addresses_may_be_outside_lahore(client, alice):
    """Lahore-only is enforced at checkout (business-rules §10, Phase 5), not when saving."""
    r = await client.post(URL, headers=alice, json=ADDR | {"city": "Karachi"})
    assert r.status_code == 201


async def test_customers_cannot_see_or_touch_each_others_addresses(client, alice, bob):
    a = (await client.post(URL, headers=alice, json=ADDR)).json()
    assert (await client.get(URL, headers=bob)).json() == []
    url = f"{URL}/{a['address_id']}"
    assert (await client.patch(url, headers=bob, json={"city": "Hacked"})).status_code == 404
    assert (await client.delete(url, headers=bob)).status_code == 404
    mine = (await client.get(URL, headers=alice)).json()
    assert [x["city"] for x in mine] == ["Lahore"]


async def test_address_cap(client, alice):
    from app.schemas.address import MAX_ADDRESSES_PER_CUSTOMER

    for _ in range(MAX_ADDRESSES_PER_CUSTOMER):
        assert (await client.post(URL, headers=alice, json=ADDR)).status_code == 201
    assert (await client.post(URL, headers=alice, json=ADDR)).status_code == 409


async def test_deleting_customer_cascades_to_addresses(client, alice, db_engine):
    await client.post(URL, headers=alice, json=ADDR)
    async with db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM customers"))
        assert (await conn.execute(text("SELECT count(*) FROM addresses"))).scalar() == 0
