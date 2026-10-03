import uuid

import pytest

from tests.conftest import auth


async def test_missing_token_is_401(client):
    r = await client.get("/api/customers/me")
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"exp_offset": -10},
        {"issuer": "https://evil.example/auth/v1"},
        {"audience": "anon"},
    ],
    ids=["expired", "wrong-issuer", "wrong-audience"],
)
async def test_invalid_claims_are_401(client, make_token, kwargs):
    r = await client.get("/api/customers/me", headers=auth(make_token(**kwargs)))
    assert r.status_code == 401
    assert r.json() == {"detail": "Not authenticated"}  # no reason leaked


async def test_token_signed_with_wrong_key_is_401(client, make_token, other_key):
    r = await client.get("/api/customers/me", headers=auth(make_token(key=other_key)))
    assert r.status_code == 401


async def test_tampered_token_is_401(client, make_token):
    token = make_token()
    head, payload, sig = token.split(".")
    forged = ".".join([head, payload[:-2] + ("AA" if payload[-2:] != "AA" else "BB"), sig])
    r = await client.get("/api/customers/me", headers=auth(forged))
    assert r.status_code == 401


async def test_garbage_token_is_401(client):
    r = await client.get("/api/customers/me", headers=auth("not-a-jwt"))
    assert r.status_code == 401


async def test_hs256_token_is_rejected(client, make_token):
    token = make_token(key="x" * 32, algorithm="HS256")
    r = await client.get("/api/customers/me", headers=auth(token))
    assert r.status_code == 401


async def test_non_uuid_subject_is_401(client, make_token):
    import jwt as pyjwt

    from tests.conftest import _PRIVATE_KEY

    token = pyjwt.encode(
        {
            "sub": "not-a-uuid",
            "aud": "authenticated",
            "iss": "https://test-project.supabase.co/auth/v1",
            "exp": 4102444800,
        },
        _PRIVATE_KEY,
        algorithm="ES256",
    )
    assert (await client.get("/api/customers/me", headers=auth(token))).status_code == 401


# --- admin authorization -------------------------------------------------------------


async def test_admin_endpoint_requires_auth(client):
    assert (await client.get("/api/admin/me")).status_code == 401


async def test_customer_cannot_use_admin_endpoint(client, make_token):
    r = await client.get("/api/admin/me", headers=auth(make_token()))
    assert r.status_code == 403


async def test_user_metadata_cannot_grant_admin(client, make_token):
    """user_metadata is user-editable; only app_metadata may grant the admin role."""
    r = await client.get("/api/admin/me", headers=auth(make_token(user_meta_admin=True)))
    assert r.status_code == 403


async def test_admin_can_use_admin_endpoint(client, make_token):
    uid = uuid.uuid4()
    r = await client.get("/api/admin/me", headers=auth(make_token(sub=uid, admin=True)))
    assert r.status_code == 200
    assert r.json() == {"id": str(uid), "role": "admin"}
