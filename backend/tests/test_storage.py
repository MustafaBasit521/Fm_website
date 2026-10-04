import json
import logging

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.core.storage import StorageNotConfiguredError, SupabaseStorage


def settings(key: str | None = "service-secret") -> Settings:
    return Settings(
        database_url="postgresql+asyncpg://x:y@h/db",
        supabase_url="https://proj.supabase.co/",
        supabase_service_key=SecretStr(key) if key else None,
        _env_file=None,
    )


def storage(handler, key: str | None = "service-secret") -> SupabaseStorage:
    return SupabaseStorage(settings(key), transport=httpx.MockTransport(handler))


async def test_signed_upload_request_and_response_shapes():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"], seen["url"] = request.method, str(request.url)
        seen["auth"] = request.headers["authorization"]
        return httpx.Response(
            200, json={"url": "/object/upload/sign/product-images/p/a.jpg?token=abc"}
        )

    signed = await storage(handler).create_signed_upload("p/a.jpg")
    assert seen["method"] == "POST"
    assert (
        seen["url"]
        == "https://proj.supabase.co/storage/v1/object/upload/sign/product-images/p/a.jpg"
    )
    assert seen["auth"] == "Bearer service-secret"
    assert signed.token == "abc"
    assert signed.upload_url.endswith("/object/upload/sign/product-images/p/a.jpg?token=abc")
    assert "service-secret" not in signed.upload_url  # the secret never reaches the browser


async def test_signed_upload_failure_raises():
    s = storage(lambda r: httpx.Response(500))
    with pytest.raises(httpx.HTTPStatusError):
        await s.create_signed_upload("p/a.jpg")


async def test_delete_sends_prefixes_and_swallows_failures(caplog):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, str(request.url), json.loads(request.content)))
        return httpx.Response(500)

    with caplog.at_level(logging.ERROR):
        await storage(handler).delete(["p/a.jpg", "p/b.png"])  # must not raise
    assert calls == [
        (
            "DELETE",
            "https://proj.supabase.co/storage/v1/object/product-images",
            {"prefixes": ["p/a.jpg", "p/b.png"]},
        )
    ]
    assert "Failed to delete" in caplog.text
    assert "service-secret" not in caplog.text


async def test_delete_with_no_paths_makes_no_request():
    def handler(request):
        raise AssertionError("no request expected")

    await storage(handler).delete([])


async def test_requires_service_key():
    s = storage(lambda r: httpx.Response(200), key=None)
    with pytest.raises(StorageNotConfiguredError):
        await s.create_signed_upload("p/a.jpg")


def test_public_url_needs_no_secret():
    s = storage(lambda r: httpx.Response(200), key=None)
    assert s.public_url("p/a.jpg") == (
        "https://proj.supabase.co/storage/v1/object/public/product-images/p/a.jpg"
    )
