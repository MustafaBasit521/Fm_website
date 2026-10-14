import logging

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.rate_limit import limiter
from app.main import create_app
from tests.test_checkout import place

BASE = {"database_url": "postgresql+asyncpg://x:y@h/db", "supabase_url": "https://p.supabase.co"}


# ---- security headers ----------------------------------------------------------------------


async def test_api_responses_carry_security_headers(client):
    r = await client.get("/api/products")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert "strict-transport-security" not in r.headers  # only in production (HTTPS)


async def test_private_and_changing_responses_are_never_cacheable(client, customer_h):
    assert "cache-control" not in (await client.get("/api/products")).headers  # public: cacheable
    assert (await client.get("/api/customers/me", headers=customer_h)).headers[
        "cache-control"
    ] == "no-store"
    posted = await client.post(
        "/api/contact", json={"name": "S", "email": "s@example.com", "message": "hi"}
    )
    assert posted.headers["cache-control"] == "no-store"


async def test_errors_and_rate_limit_responses_also_get_the_headers_and_cors(client):
    r = await client.get("/api/customers/me", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 401
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


# ---- request ids, logging, unexpected errors -----------------------------------------------


async def test_every_response_has_a_request_id(client):
    a = await client.get("/api/products")
    b = await client.get("/api/products")
    assert (
        len(a.headers["x-request-id"]) == 16
        and a.headers["x-request-id"] != b.headers["x-request-id"]
    )


async def test_requests_are_logged_without_query_strings(client, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        await client.get("/api/products", params={"search": "secret-term"})
    line = next(r.getMessage() for r in caplog.records if r.name == "app.request")
    assert "GET /api/products -> 200" in line and "secret-term" not in line


async def test_an_unexpected_error_returns_a_generic_json_500_and_logs_the_traceback(
    db_engine, caplog
):
    app = create_app()

    async def broken():
        raise RuntimeError("database password is hunter2")
        yield  # pragma: no cover

    app.dependency_overrides[get_session] = broken
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        with caplog.at_level(logging.ERROR):
            r = await c.get("/api/categories", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 500
    body = r.json()
    assert body["detail"] == "Internal server error"
    assert body["request_id"] == r.headers["x-request-id"]
    assert "hunter2" not in r.text and "Traceback" not in r.text  # nothing internal leaks
    assert "hunter2" in caplog.text  # ...but the operator can find it in the log, by request id
    assert body["request_id"] in caplog.text
    assert (
        r.headers["access-control-allow-origin"] == "http://localhost:5173"
    )  # browser can read it


# ---- rate limits on the public write routes ------------------------------------------------


async def test_order_creation_is_rate_limited_per_client(client, make_product):
    a = await make_product(stock_quantity=50)
    limiter.enabled = True
    for _ in range(10):
        assert (await place(client, [(a["product_id"], 1)])).status_code == 201
    blocked = await place(client, [(a["product_id"], 1)])
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) >= 1


async def test_quote_pay_and_refresh_are_rate_limited(client, make_product, online_enabled):
    a = await make_product(stock_quantity=5)
    limiter.enabled = True
    quote = {"items": [{"product_id": a["product_id"], "quantity": 1}]}
    codes = [(await client.post("/api/checkout/quote", json=quote)).status_code for _ in range(121)]
    assert codes[:120] == [200] * 120 and codes[120] == 429
    oid = "00000000-0000-0000-0000-000000000001"
    pay = [(await client.post(f"/api/orders/{oid}/pay")).status_code for _ in range(21)]
    assert pay[:20] == [404] * 20 and pay[20] == 429
    refresh = [
        (await client.post(f"/api/orders/{oid}/payment/refresh")).status_code for _ in range(61)
    ]
    assert refresh[:60] == [404] * 60 and refresh[60] == 429


async def test_the_database_health_check_is_rate_limited_but_liveness_is_not(client):
    limiter.enabled = True
    codes = [(await client.get("/api/health/db")).status_code for _ in range(31)]
    assert codes[30] == 429
    for _ in range(40):
        assert (await client.get("/api/health")).status_code == 200


async def test_limits_are_per_client_address_and_do_not_affect_others(client):
    limiter.enabled = True
    body = {"name": "S", "email": "s@example.com", "message": "hi"}
    for _ in range(5):
        await client.post("/api/contact", json=body)
    assert (await client.post("/api/contact", json=body)).status_code == 429
    # a different route has its own budget
    assert (await client.get("/api/products")).status_code == 200


async def test_the_global_backstop_limits_everything_except_webhooks_health_and_preflight(client):
    base = get_settings()
    # the middleware reads its budget when the app is built, so build a fresh app with it
    import app.main as main

    original = main.get_settings
    main.get_settings = lambda: Settings(
        **{**base.model_dump(), "global_rate_limit_per_minute": 5}, _env_file=None
    )
    try:
        tight = create_app()
    finally:
        main.get_settings = original
    tight.dependency_overrides.update(client.app.dependency_overrides)
    limiter.enabled = True
    async with AsyncClient(transport=ASGITransport(app=tight), base_url="http://test") as c:
        codes = [(await c.get("/api/gallery")).status_code for _ in range(6)]
        assert codes[:5] == [200] * 5 and codes[5] == 429
        assert (await c.get("/api/health")).status_code == 200  # exempt
        pre = await c.options(
            "/api/gallery",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
        )
        assert pre.status_code == 200  # CORS preflight is never blocked
        hook = await c.post("/api/payments/webhook/fake", content=b"{}")
        assert hook.status_code != 429  # exempt (503 here: no provider configured)
        limited = await c.get("/api/gallery")
        assert limited.status_code == 429 and "retry-after" in limited.headers
        assert limited.json()["detail"].startswith("Too many requests")


def test_settings_validate_log_level_and_defaults():
    assert Settings(**BASE, _env_file=None).global_rate_limit_per_minute == 600
    with pytest.raises(ValidationError):
        Settings(**BASE, log_level="LOUD", _env_file=None)


async def test_production_without_proxy_trust_logs_a_warning(caplog):
    import app.main as main

    original = main.get_settings
    main.get_settings = lambda: Settings(**BASE, app_env="production", _env_file=None)
    try:
        app = main.create_app()
        with caplog.at_level(logging.WARNING):
            async with app.router.lifespan_context(app):
                pass
    finally:
        main.get_settings = original
    assert "TRUST_PROXY_HEADERS is off in production" in caplog.text
