import pytest
from httpx import ASGITransport, AsyncClient

from app.core.db import get_session
from app.main import create_app


class _OkSession:
    async def execute(self, *_a, **_k):
        return None


class _BrokenSession:
    async def execute(self, *_a, **_k):
        raise ConnectionError("secret-host:5432 refused")


def _client(session_cls=None):
    app = create_app()
    if session_cls is not None:

        async def override():
            yield session_cls()

        app.dependency_overrides[get_session] = override
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_liveness_does_not_need_database():
    async with _client() as c:
        r = await c.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_db_health_ok():
    async with _client(_OkSession) as c:
        r = await c.get("/api/health/db")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_db_health_failure_is_503_and_leaks_nothing():
    async with _client(_BrokenSession) as c:
        r = await c.get("/api/health/db")
    assert r.status_code == 503
    assert r.json() == {"status": "unavailable"}
    assert "secret-host" not in r.text


async def test_cors_allows_configured_origin_only():
    async with _client() as c:
        ok = await c.get("/api/health", headers={"Origin": "http://localhost:5173"})
        bad = await c.get("/api/health", headers={"Origin": "http://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers


@pytest.mark.parametrize("value", ["postgresql://x", "mysql://x"])
def test_database_url_must_be_asyncpg(value):
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(database_url=value, _env_file=None)
