import os

# Tests must never read a developer's .env or touch a real (Supabase) database.
os.environ["DATABASE_URL"] = (
    "postgresql+asyncpg://crochet:crochet_dev_password@localhost:5433/crochet_test"
)
os.environ["SUPABASE_URL"] = "https://test-project.supabase.co"

import time  # noqa: E402
import uuid  # noqa: E402

import asyncpg  # noqa: E402
import jwt  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

import app.models  # noqa: E402, F401
from app.core.auth import KeyResolver, get_key_resolver  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.db import Base, get_session  # noqa: E402
from app.core.storage import SignedUpload, SupabaseStorage, get_storage  # noqa: E402
from app.main import create_app  # noqa: E402

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


@pytest_asyncio.fixture
async def db_engine():
    """Dedicated test database on the local Docker Postgres. Skips if unavailable."""
    try:
        admin = await asyncpg.connect(
            "postgresql://crochet:crochet_dev_password@localhost:5433/postgres", timeout=3
        )
    except Exception:
        pytest.skip("local test Postgres not available (run `make db`)")
    try:
        if not await admin.fetchval("SELECT 1 FROM pg_database WHERE datname='crochet_test'"):
            await admin.execute("CREATE DATABASE crochet_test")
    finally:
        await admin.close()
    engine = create_async_engine(os.environ["DATABASE_URL"])
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
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
        await conn.execute(text("TRUNCATE product_images, products, categories, customers CASCADE"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
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
