import json
import logging

import httpx
import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core import rate_limit as rl
from app.core.config import Settings, get_settings
from app.core.email.base import EmailMessage
from app.core.email.outbox import queue_email, send_emails, take_ready
from app.core.email.providers import ConsoleEmailProvider, NullEmailProvider, build_email_provider
from app.core.money import format_price
from app.core.rate_limit import RateLimiter, limiter
from app.core.storage import SupabaseStorage

BASE = {"database_url": "postgresql+asyncpg://x:y@h/db", "supabase_url": "https://p.supabase.co"}
MSG = EmailMessage(to="a@example.com", subject="Hello", body="Body text")


# ---- rate limiter --------------------------------------------------------------------------


def test_limiter_blocks_after_the_limit_and_reports_retry_after():
    lim = RateLimiter()
    assert [lim.hit("k", 3, 60) for _ in range(3)] == [None, None, None]
    retry = lim.hit("k", 3, 60)
    assert retry is not None and 1 <= retry <= 61
    assert lim.hit("other", 3, 60) is None  # separate keys do not share a budget


def test_limiter_window_slides(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(rl.time, "monotonic", lambda: clock[0])
    lim = RateLimiter()
    for _ in range(2):
        assert lim.hit("k", 2, 60) is None
    assert lim.hit("k", 2, 60) is not None
    clock[0] += 61  # the window has passed
    assert lim.hit("k", 2, 60) is None


def test_disabled_limiter_never_blocks():
    lim = RateLimiter()
    lim.enabled = False
    assert all(lim.hit("k", 1, 60) is None for _ in range(10))


CONTACT = {"name": "Sara", "email": "sara@example.com", "message": "Hello there"}


async def test_public_endpoint_returns_429_with_retry_after(client):
    limiter.enabled = True
    for _ in range(5):
        assert (await client.post("/api/contact", json=CONTACT)).status_code == 201
    r = await client.post("/api/contact", json=CONTACT)
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1


async def test_spoofed_forwarded_for_header_is_ignored_unless_trusted(client):
    limiter.enabled = True
    for i in range(5):
        r = await client.post(
            "/api/contact", json=CONTACT, headers={"x-forwarded-for": f"9.9.9.{i}"}
        )
        assert r.status_code == 201
    spoofed = await client.post(
        "/api/contact", json=CONTACT, headers={"x-forwarded-for": "1.2.3.4"}
    )
    assert spoofed.status_code == 429  # the header does not buy a fresh budget

    limiter.reset()
    base = get_settings()
    client.app.dependency_overrides[get_settings] = lambda: Settings(
        **{**base.model_dump(), "trust_proxy_headers": True}, _env_file=None
    )
    for _ in range(5):
        assert (
            await client.post("/api/contact", json=CONTACT, headers={"x-forwarded-for": "1.1.1.1"})
        ).status_code == 201
    assert (
        await client.post("/api/contact", json=CONTACT, headers={"x-forwarded-for": "1.1.1.1"})
    ).status_code == 429
    # behind a trusted proxy each real client has its own budget
    assert (
        await client.post("/api/contact", json=CONTACT, headers={"x-forwarded-for": "2.2.2.2"})
    ).status_code == 201


# ---- email outbox: only for changes that committed ------------------------------------------


async def test_queued_email_is_released_only_by_a_commit(db_engine):
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as s:
        await s.execute(text("SELECT 1"))  # a change is in progress (a transaction has begun)
        queue_email(s, MSG)
        assert take_ready(s) == []  # nothing is released before the commit
        await s.commit()
        assert take_ready(s) == [MSG]
        assert take_ready(s) == []  # taken once
    async with maker() as s:
        await s.execute(text("SELECT 1"))
        queue_email(s, MSG)
        await s.rollback()  # the change never happened, so the email must not be sent
        await s.commit()
        assert take_ready(s) == []


async def test_a_failing_provider_never_raises_and_other_emails_still_go_out(caplog):
    class Flaky:
        name = "flaky"

        def __init__(self):
            self.sent = []

        async def send(self, message):
            if message.subject == "bad":
                raise RuntimeError("smtp down")
            self.sent.append(message)

    provider = Flaky()
    bad = EmailMessage(to="x@example.com", subject="bad", body="b")
    with caplog.at_level(logging.ERROR):
        await send_emails([bad, MSG], provider)  # must not raise
    assert provider.sent == [MSG]
    assert "Could not send email" in caplog.text


async def test_null_provider_sends_nothing_and_console_provider_logs(caplog):
    await NullEmailProvider().send(MSG)
    with caplog.at_level(logging.INFO, logger="app.email"):
        await ConsoleEmailProvider().send(MSG)
    assert "Hello" in caplog.text and "a@example.com" in caplog.text
    assert isinstance(build_email_provider(Settings(**BASE, _env_file=None)), NullEmailProvider)
    console = Settings(**BASE, email_provider="console", _env_file=None)
    assert isinstance(build_email_provider(console), ConsoleEmailProvider)


def test_settings_refuse_unsafe_email_configuration():
    with pytest.raises(ValidationError):
        Settings(**BASE, app_env="production", email_provider="console", _env_file=None)
    with pytest.raises(ValidationError):
        Settings(**BASE, email_provider="sendgrid", _env_file=None)


def test_format_price_uses_integer_math():
    assert format_price(0) == "Rs 0"
    assert format_price(125050) == "Rs 1,250.50"
    assert format_price(125000) == "Rs 1,250"
    assert format_price(5) == "Rs 0.05"
    assert format_price(100000000) == "Rs 1,000,000"


# ---- storage: other buckets, private signed downloads --------------------------------------


def _storage(handler) -> SupabaseStorage:
    settings = Settings(
        **BASE,
        supabase_service_key=SecretStr("service-secret"),
        _env_file=None,
    )
    return SupabaseStorage(settings, transport=httpx.MockTransport(handler))


async def test_uploads_and_deletes_target_the_requested_bucket():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        if request.method == "POST":
            return httpx.Response(200, json={"url": "/x?token=abc"})
        return httpx.Response(200, json={})

    s = _storage(handler)
    signed = await s.create_signed_upload("custom-orders/a.jpg", s.custom_orders_bucket)
    assert "/custom-order-references/custom-orders/a.jpg" in signed.upload_url
    await s.delete(["gallery/a.jpg"], s.gallery_bucket)
    assert seen[0][1].endswith("/object/upload/sign/custom-order-references/custom-orders/a.jpg")
    assert seen[1] == ("DELETE", "/storage/v1/object/gallery-images")
    assert "/gallery-images/" in s.public_url("gallery/a.jpg", s.gallery_bucket)


async def test_signed_download_for_the_private_bucket():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        captured["auth"] = request.headers["authorization"]
        return httpx.Response(200, json={"signedURL": "/object/sign/b/p.jpg?token=t1"})

    s = _storage(handler)
    url = await s.create_signed_download("custom-orders/p.jpg", s.custom_orders_bucket, 600)
    assert captured["url"].endswith(
        "/storage/v1/object/sign/custom-order-references/custom-orders/p.jpg"
    )
    assert captured["body"] == {"expiresIn": 600}
    assert url == "https://p.supabase.co/storage/v1/object/sign/b/p.jpg?token=t1"
    assert "service-secret" not in url  # the key never appears in the link
