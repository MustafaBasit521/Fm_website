import json

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.email.base import EmailError, EmailMessage
from app.core.email.providers import ResendEmailProvider, build_email_provider

BASE = {"database_url": "postgresql+asyncpg://x:y@h/db", "supabase_url": "https://p.supabase.co"}
# Obviously fake, and assembled at run time so secret scanners do not mistake it for a real key.
KEY = "-".join(["not", "a", "real", "key"])
MSG = EmailMessage(to="sara@example.com", subject="Hello", body="Plain text body")


def settings(**over):
    return Settings(
        **BASE,
        email_provider="resend",
        resend_api_key=KEY,
        email_from="Bundle of Loops <hello@example.com>",
        _env_file=None,
        **over,
    )


def provider(handler):
    return ResendEmailProvider(settings(), transport=httpx.MockTransport(handler))


async def test_sends_one_authenticated_json_request():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "abc"})

    await provider(handler).send(MSG)
    (request,) = seen
    assert str(request.url) == "https://api.resend.com/emails"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    assert json.loads(request.content) == {
        "from": "Bundle of Loops <hello@example.com>",
        "to": ["sara@example.com"],
        "subject": "Hello",
        "text": "Plain text body",
    }


@pytest.mark.parametrize("status", [401, 403, 422, 429, 500])
async def test_a_refusal_becomes_an_email_error_without_the_key(status):
    def handler(request):
        return httpx.Response(status, json={"message": "domain is not verified"})

    with pytest.raises(EmailError) as err:
        await provider(handler).send(MSG)
    assert str(status) in str(err.value) and "not verified" in str(err.value)
    assert KEY not in str(err.value)


async def test_a_network_failure_becomes_an_email_error():
    def handler(request):
        raise httpx.ConnectError("boom")

    with pytest.raises(EmailError, match="could not be reached"):
        await provider(handler).send(MSG)


def test_settings_for_resend_need_the_key_and_the_sender():
    with pytest.raises(ValidationError):
        Settings(**BASE, email_provider="resend", email_from="a@example.com", _env_file=None)
    with pytest.raises(ValidationError):
        Settings(**BASE, email_provider="resend", resend_api_key=KEY, _env_file=None)
    assert isinstance(build_email_provider(settings()), ResendEmailProvider)


def test_the_api_key_is_not_printed_with_the_settings():
    s = settings()
    assert KEY not in repr(s) and KEY not in str(s.model_dump())
