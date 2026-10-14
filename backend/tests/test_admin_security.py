import logging
import re
import time
import uuid

import jwt
import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.core.audit import action_for
from app.core.config import Settings, get_settings
from tests.conftest import _PRIVATE_KEY, ISSUER, auth

BASE = {"database_url": "postgresql+asyncpg://x:y@h/db", "supabase_url": "https://p.supabase.co"}
UUID_ = "00000000-0000-0000-0000-000000000001"


def admin_routes(app) -> list[tuple[str, str]]:
    """Every /api/admin/* route in the app (method, path with ids filled in), except /me."""
    spec = app.openapi()
    found = []
    for path, methods in spec["paths"].items():
        if not path.startswith("/api/admin") or path == "/api/admin/me":
            continue
        filled = re.sub(r"\{[^}]+\}", UUID_, path)
        for method in methods:
            found.append((method.upper(), filled))
    return sorted(found)


async def audit_rows(db_engine):
    async with db_engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT user_id, action, path, status_code, ip FROM admin_audit_log ORDER BY created_at"
                )
            )
        ).all()
    return [tuple(r) for r in rows]


# ---- second factor (MFA) -------------------------------------------------------------------


async def test_identity_check_tells_the_admin_site_what_is_missing(client, make_token):
    uid = uuid.uuid4()
    r = await client.get("/api/admin/me", headers=auth(make_token(sub=uid, admin=True, aal="aal1")))
    assert r.status_code == 200
    assert r.json() == {
        "id": str(uid),
        "role": "admin",
        "mfa_required": True,
        "mfa_verified": False,
    }
    done = await client.get("/api/admin/me", headers=auth(make_token(sub=uid, admin=True)))
    assert done.json()["mfa_verified"] is True


async def test_every_admin_route_requires_the_second_factor(client, make_token):
    """Walks the real route table, so a future admin route cannot forget the MFA rule."""
    routes = admin_routes(client.app)
    assert len(routes) >= 35  # sanity: we are really covering the whole admin surface
    no_mfa = auth(make_token(admin=True, aal="aal1"))
    customer = auth(make_token(aal="aal2"))  # a second factor does not make a customer an admin
    for method, path in routes:
        anon = await client.request(method, path, json={})
        assert anon.status_code == 401, (method, path)
        r = await client.request(method, path, headers=no_mfa, json={})
        assert r.status_code == 403, (method, path)
        assert r.json()["detail"]["code"] == "MFA_REQUIRED", (method, path)
        c = await client.request(method, path, headers=customer, json={})
        assert c.status_code == 403 and c.json()["detail"] == "Forbidden", (method, path)


async def test_a_completed_second_factor_unlocks_the_admin_routes(client, make_token):
    ok = auth(make_token(admin=True))  # aal2
    assert (await client.get("/api/admin/dashboard", headers=ok)).status_code == 200
    assert (await client.get("/api/admin/orders", headers=ok)).status_code == 200


async def test_claims_a_user_can_edit_never_grant_mfa_or_admin(client):
    """Only the signed top-level claims count; user_metadata is user-editable."""
    claims = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": int(time.time()) + 3600,
        "email": "x@example.com",
        "aal": "aal1",
        "app_metadata": {"role": "admin"},
        "user_metadata": {"aal": "aal2", "role": "admin"},
    }
    token = jwt.encode(claims, _PRIVATE_KEY, algorithm="ES256")
    r = await client.get("/api/admin/dashboard", headers=auth(token))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "MFA_REQUIRED"


async def test_mfa_can_be_switched_off_for_local_development(client, make_token):
    base = get_settings()
    client.app.dependency_overrides[get_settings] = lambda: Settings(
        **{**base.model_dump(), "admin_require_mfa": False}, _env_file=None
    )
    r = await client.get("/api/admin/dashboard", headers=auth(make_token(admin=True, aal="aal1")))
    assert r.status_code == 200
    me = await client.get("/api/admin/me", headers=auth(make_token(admin=True, aal="aal1")))
    assert me.json()["mfa_required"] is False


def test_production_refuses_to_run_without_mfa():
    with pytest.raises(ValidationError):
        Settings(**BASE, app_env="production", admin_require_mfa=False, _env_file=None)
    assert Settings(**BASE, app_env="production", _env_file=None).admin_require_mfa is True
    assert Settings(**BASE, app_env="development", admin_require_mfa=False, _env_file=None)


def test_both_sites_are_allowed_origins_by_default():
    origins = Settings(**BASE, _env_file=None).cors_origins
    assert "http://localhost:5173" in origins and "http://localhost:5174" in origins


async def test_browsers_on_unknown_origins_get_no_cors_permission(client):
    ok = await client.options(
        "/api/products",
        headers={"Origin": "http://localhost:5174", "Access-Control-Request-Method": "GET"},
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5174"
    bad = await client.options(
        "/api/products",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in bad.headers


# ---- audit log -----------------------------------------------------------------------------


def test_actions_mask_ids_so_they_group_together():
    assert (
        action_for("POST", f"/api/admin/orders/{uuid.uuid4()}/cancel")
        == "POST /api/admin/orders/{id}/cancel"
    )
    assert (
        action_for("DELETE", "/api/admin/categories/not-a-uuid")
        == "DELETE /api/admin/categories/not-a-uuid"
    )


async def test_admin_changes_are_recorded_with_who_what_and_outcome(client, make_token, db_engine):
    uid = uuid.uuid4()
    h = auth(make_token(sub=uid, admin=True))
    created = await client.post("/api/admin/categories", headers=h, json={"name": "Flowers"})
    assert created.status_code == 201
    missing = uuid.uuid4()
    await client.patch(f"/api/admin/categories/{missing}", headers=h, json={"name": "X"})  # 404
    await client.post("/api/admin/categories", headers=h, json={"name": " "})  # 422
    rows = await audit_rows(db_engine)
    assert [(r[0], r[1], r[3]) for r in rows] == [
        (uid, "POST /api/admin/categories", 201),
        (uid, "PATCH /api/admin/categories/{id}", 404),  # failed changes are recorded too
        (uid, "POST /api/admin/categories", 422),
    ]
    assert rows[1][2] == f"/api/admin/categories/{missing}"  # the real path is kept
    assert rows[0][4]  # the client address is recorded


async def test_reads_unauthenticated_requests_and_public_routes_are_not_logged(
    client, admin_h, db_engine
):
    await client.get("/api/admin/dashboard", headers=admin_h)
    await client.get("/api/admin/orders", headers=admin_h)
    await client.get("/api/admin/dashboard")  # no token
    await client.post("/api/admin/categories", json={"name": "x"})  # no token
    await client.get("/api/admin/dashboard", headers=auth("garbage"))
    await client.post("/api/contact", json={"name": "S", "email": "s@example.com", "message": "hi"})
    assert await audit_rows(db_engine) == []


async def test_refused_attempts_by_signed_in_users_are_recorded(client, make_token, db_engine):
    customer = uuid.uuid4()
    await client.get(
        "/api/admin/dashboard", headers=auth(make_token(sub=customer))
    )  # 403 on a read
    await client.post("/api/admin/products", headers=auth(make_token(sub=customer)), json={})
    admin = uuid.uuid4()
    await client.get(
        "/api/admin/dashboard", headers=auth(make_token(sub=admin, admin=True, aal="aal1"))
    )
    rows = await audit_rows(db_engine)
    assert [(r[0], r[1], r[3]) for r in rows] == [
        (customer, "GET /api/admin/dashboard", 403),
        (customer, "POST /api/admin/products", 403),
        (admin, "GET /api/admin/dashboard", 403),  # an admin without the second factor
    ]


async def test_request_bodies_are_never_stored(client, admin_h, db_engine):
    await client.post(
        "/api/admin/categories", headers=admin_h, json={"name": "TopSecretCategoryName"}
    )
    async with db_engine.connect() as conn:
        dump = (
            await conn.execute(text("SELECT row_to_json(a)::text FROM admin_audit_log a"))
        ).scalar()
    assert "TopSecretCategoryName" not in dump and "admin" in dump


async def test_a_failing_audit_write_never_breaks_the_request(client, admin_h, caplog):
    class Broken:
        def __call__(self):
            raise RuntimeError("audit database down")

    client.app.state.audit_sessionmaker = Broken()
    with caplog.at_level(logging.ERROR):
        r = await client.post("/api/admin/categories", headers=admin_h, json={"name": "Flowers"})
    assert r.status_code == 201  # the admin's change still went through
    assert "Could not write the admin audit log entry" in caplog.text


async def test_the_audit_log_can_be_read_but_not_changed_through_the_api(
    client, make_token, admin_h
):
    one, two = uuid.uuid4(), uuid.uuid4()
    await client.post(
        "/api/admin/categories", headers=auth(make_token(sub=one, admin=True)), json={"name": "A"}
    )
    await client.post(
        "/api/admin/categories", headers=auth(make_token(sub=two, admin=True)), json={"name": "B"}
    )
    page = (await client.get("/api/admin/audit-log", headers=admin_h)).json()
    assert page["total"] == 2
    assert [e["user_id"] for e in page["items"]] == [str(two), str(one)]  # newest first
    assert page["items"][0]["action"] == "POST /api/admin/categories"
    only_one = (
        await client.get("/api/admin/audit-log", headers=admin_h, params={"user_id": str(one)})
    ).json()
    assert only_one["total"] == 1
    p2 = (
        await client.get(
            "/api/admin/audit-log", headers=admin_h, params={"page": 2, "page_size": 1}
        )
    ).json()
    assert len(p2["items"]) == 1
    assert (
        await client.get("/api/admin/audit-log", headers=admin_h, params={"page_size": 101})
    ).status_code == 422
    # reading the log is not itself logged, and no route can edit or delete entries
    assert (await client.get("/api/admin/audit-log", headers=admin_h)).json()["total"] == 2
    methods = {m for p, ms in client.app.openapi()["paths"].items() if "audit-log" in p for m in ms}
    assert methods == {"get"}


async def test_the_audit_log_is_admin_only(client, customer_h, make_token):
    assert (await client.get("/api/admin/audit-log")).status_code == 401
    assert (await client.get("/api/admin/audit-log", headers=customer_h)).status_code == 403
    no_mfa = auth(make_token(admin=True, aal="aal1"))
    assert (await client.get("/api/admin/audit-log", headers=no_mfa)).status_code == 403
