import os

# Tests must never read a developer's .env or touch a real (Supabase) database.
os.environ["DATABASE_URL"] = (
    "postgresql+asyncpg://crochet:crochet_dev_password@localhost:5433/crochet_test"
)
os.environ["SUPABASE_URL"] = "https://test-project.supabase.co"

import time
import uuid

import asyncpg
import jwt
import pytest
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import ec
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401  (registers models on Base.metadata)
from app.core.auth import KeyResolver, get_key_resolver
from app.core.config import get_settings
from app.core.db import get_session
from app.core.storage import SignedUpload, SupabaseStorage, get_storage
from app.main import create_app

ISSUER = "https://test-project.supabase.co/auth/v1"
_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
_OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


class _TestResolver(KeyResolver):
    async def __call__(self, token: str):
        return _PRIVATE_KEY.public_key()


@pytest.fixture
def make_token():
    def _make(
        *,
        sub: uuid.UUID | None = None,
        email: str | None = "Ayesha@Example.com",
        name: str | None = "Ayesha",
        admin: bool = False,
        user_meta_admin: bool = False,
        exp_offset: int = 3600,
        issuer: str = ISSUER,
        audience: str = "authenticated",
        key=_PRIVATE_KEY,
        algorithm: str = "ES256",
    ) -> str:
        claims = {
            "sub": str(sub or uuid.uuid4()),
            "aud": audience,
            "iss": issuer,
            "exp": int(time.time()) + exp_offset,
            "app_metadata": {"role": "admin"} if admin else {},
            "user_metadata": {"name": name, "role": "admin"} if user_meta_admin else {"name": name},
        }
        if email:
            claims["email"] = email
        return jwt.encode(claims, key, algorithm=algorithm)

    return _make


@pytest.fixture
def other_key():
    return _OTHER_KEY


_ADMIN_DSN = "postgresql://crochet:crochet_dev_password@localhost:5433/postgres"


async def _reset_test_database() -> None:
    admin = await asyncpg.connect(_ADMIN_DSN, timeout=3)
    try:
        if not await admin.fetchval("SELECT 1 FROM pg_database WHERE datname='crochet_test'"):
            await admin.execute("CREATE DATABASE crochet_test")
    finally:
        await admin.close()
    conn = await asyncpg.connect(_ADMIN_DSN.replace("/postgres", "/crochet_test"), timeout=3)
    try:
        await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def migrated_db():
    """Build the test schema with the REAL Alembic migrations (so migrations, seed data and the
    SQL expiry function are exercised too). Local Docker Postgres only; skipped if unavailable."""
    import asyncio
    import subprocess
    import sys
    from pathlib import Path

    try:
        asyncio.run(_reset_test_database())
    except Exception:
        pytest.skip("local test Postgres not available (run `make db`)")
    backend = Path(__file__).resolve().parent.parent
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend,
        env={**os.environ},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


@pytest_asyncio.fixture
async def db_engine(migrated_db):
    engine = create_async_engine(os.environ["DATABASE_URL"])
    yield engine
    await engine.dispose()


class FakeStorage(SupabaseStorage):
    """Records calls instead of talking to Supabase."""

    def __init__(self, *, configured: bool = True):
        super().__init__(get_settings())
        self._key = "fake-key" if configured else None
        self.deleted: list[str] = []

    async def create_signed_upload(self, path: str) -> SignedUpload:
        return SignedUpload(
            path=path, token="tok", upload_url=f"https://up.example/{path}?token=tok"
        )

    async def delete(self, paths: list[str]) -> None:
        self.deleted.extend(paths)


@pytest.fixture
def storage():
    return FakeStorage()


@pytest_asyncio.fixture
async def client(db_engine, storage):
    app = create_app()
    maker = async_sessionmaker(db_engine, expire_on_commit=False)

    async def _session():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_key_resolver] = lambda: _TestResolver()
    app.dependency_overrides[get_storage] = lambda: storage
    async with db_engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE payments, order_items, orders, business_settings, wishlist_items, addresses, product_images, products, categories, customers CASCADE"
            )
        )
    async with db_engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO business_settings (setting_id, business_name, delivery_fee_paisa)"
                " VALUES (gen_random_uuid(), 'Test Shop', 20000)"
            )
        )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.app = app  # tests tweak dependency overrides (e.g. enable online payments)
        yield c


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_h(make_token):
    return auth(make_token(admin=True, email="admin@example.com", name="Admin"))


@pytest.fixture
def customer_h(make_token):
    return auth(make_token())


@pytest_asyncio.fixture
async def category_id(client, admin_h) -> str:
    r = await client.post("/api/admin/categories", headers=admin_h, json={"name": "Flowers"})
    assert r.status_code == 201
    return r.json()["category_id"]


@pytest.fixture
def make_product(client, admin_h, category_id):
    async def _make(**overrides) -> dict:
        body = {
            "category_id": category_id,
            "name": "Sunflower",
            "description": "A bright crochet sunflower",
            "price_paisa": 125050,
            "availability_type": "READY_TO_SHIP",
            "stock_quantity": 5,
            "is_visible": True,
        }
        body.update(overrides)
        r = await client.post("/api/admin/products", headers=admin_h, json=body)
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest.fixture
def online_enabled(client):
    """Turn online payments on with a fake gateway; returns that gateway so tests can drive it."""
    from app.core.config import Settings
    from app.core.payments.fake import FakeProvider
    from app.core.payments.registry import get_payment_provider

    base = get_settings()
    provider = FakeProvider(webhook_secret="test-secret", frontend_url="http://front.test")
    client.app.dependency_overrides[get_settings] = lambda: Settings(
        **{
            **base.model_dump(),
            "online_payments_enabled": True,
            "payment_provider": "fake",
            "frontend_url": "http://front.test",
        },
        _env_file=None,
    )
    client.app.dependency_overrides[get_payment_provider] = lambda: provider
    return provider
