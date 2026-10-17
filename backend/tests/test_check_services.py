import httpx

from app.core.config import Settings
from app.tools.check_services import (
    FAIL,
    MANUAL,
    PASS,
    SKIP,
    WARN,
    check_auth,
    check_email,
    check_storage,
)
from tests.test_engagement_infra import BASE


def settings(**over):
    return Settings(**BASE, supabase_service_key="service-secret-value", _env_file=None, **over)


def transport(buckets, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer service-secret-value"
        return httpx.Response(status, json=buckets)

    return httpx.MockTransport(handler)


GOOD = {"public": True, "file_size_limit": 5 * 1024 * 1024, "allowed_mime_types": ["image/png"]}


def by_name(results):
    return {r.name: r for r in results}


async def test_storage_passes_with_the_right_buckets_and_rules():
    buckets = [
        {"name": "product-images", **GOOD},
        {"name": "gallery-images", **GOOD},
        {"name": "custom-order-references", **GOOD, "public": False},
        {"name": "payment-proofs", **GOOD, "public": False},
    ]
    results = await check_storage(settings(), transport(buckets))
    assert [r.status for r in results] == [PASS, PASS, PASS, PASS]


async def test_storage_reports_a_missing_bucket_and_a_public_private_bucket():
    buckets = [
        {"name": "product-images", **GOOD},
        {"name": "custom-order-references", **GOOD},  # must be private
    ]
    got = by_name(await check_storage(settings(), transport(buckets)))
    assert got["storage bucket 'gallery-images'"].status == FAIL
    assert got["storage bucket 'payment-proofs'"].status == FAIL  # transfers need this one too
    assert got["storage bucket 'custom-order-references' visibility"].status == FAIL


async def test_storage_warns_about_missing_limits():
    bucket = {"name": "product-images", "public": True}
    got = by_name(await check_storage(settings(), transport([bucket])))
    assert got["bucket 'product-images' size limit"].status == WARN
    assert got["bucket 'product-images' allowed types"].status == WARN


async def test_storage_failures_are_explained_without_the_key():
    no_key = Settings(**BASE, _env_file=None)
    assert (await check_storage(no_key))[0].status == FAIL
    refused = await check_storage(settings(), transport({}, status=401))
    assert refused[0].status == FAIL and "401" in refused[0].detail
    assert all("service-secret-value" not in r.detail for r in refused)


async def test_auth_check_reads_the_published_signing_keys():
    ok = httpx.MockTransport(lambda r: httpx.Response(200, json={"keys": [{"kid": "a"}]}))
    results = await check_auth(settings(), ok)
    assert results[0].status == PASS
    assert any(r.status == MANUAL for r in results)  # TOTP must be enabled by hand
    empty = httpx.MockTransport(lambda r: httpx.Response(200, json={"keys": []}))
    assert (await check_auth(settings(), empty))[0].status == FAIL


async def test_email_check_skips_without_a_provider_and_only_sends_on_request():
    assert (await check_email(settings(), None))[0].status == SKIP
    console = settings(email_provider="console")
    results = await check_email(console, None)
    assert [r.status for r in results] == [PASS, SKIP]  # nothing is sent without --send-test
    sent = await check_email(console, "me@example.com")
    assert sent[-1].status == PASS and "me@example.com" in sent[-1].detail
