import logging
from typing import Annotated

import httpx
from fastapi import Depends

from app.core.config import Settings, get_settings
from app.core.email.base import EmailError, EmailMessage, EmailProvider

logger = logging.getLogger("app.email")


def _ensure_visible() -> None:
    """The console provider exists to be read, so it must not depend on how the server configured
    logging (by default INFO messages are dropped). Give its logger its own handler once."""
    if not any(getattr(h, "_app_email", False) for h in logger.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        handler._app_email = True  # type: ignore[attr-defined]
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class NullEmailProvider:
    """Sends nothing (the default until a real provider is chosen)."""

    name = "none"

    async def send(self, message: EmailMessage) -> None:
        logger.debug("Email not sent (no provider configured): %s", message.subject)


class ConsoleEmailProvider:
    """Development only: prints emails to the server log instead of sending them."""

    name = "console"

    def __init__(self) -> None:
        _ensure_visible()

    async def send(self, message: EmailMessage) -> None:
        logger.info("EMAIL to=%s subject=%s\n%s", message.to, message.subject, message.body)


class ResendEmailProvider:
    """Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
    The API key stays on the server and is never logged or included in error messages."""

    name = "resend"
    url = "https://api.resend.com/emails"

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        assert settings.resend_api_key and settings.email_from  # checked by Settings
        self._key = settings.resend_api_key.get_secret_value()
        self._from = settings.email_from
        self._transport = transport  # tests inject a mock transport; None = real network

    async def send(self, message: EmailMessage) -> None:
        payload = {
            "from": self._from,
            "to": [message.to],
            "subject": message.subject,
            "text": message.body,
        }
        try:
            async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
                res = await client.post(
                    self.url, json=payload, headers={"Authorization": f"Bearer {self._key}"}
                )
        except httpx.HTTPError as e:
            raise EmailError(f"Resend could not be reached ({type(e).__name__})") from e
        if res.status_code >= 400:
            # the response body can say what is wrong (unverified domain, bad address) but may echo
            # the recipient, so only a short, bounded piece of it is kept for the server log
            raise EmailError(f"Resend refused the email ({res.status_code}): {res.text[:200]}")


def build_email_provider(settings: Settings) -> EmailProvider:
    if settings.email_provider == "resend":
        return ResendEmailProvider(settings)
    return ConsoleEmailProvider() if settings.email_provider == "console" else NullEmailProvider()


def get_email_provider(settings: Annotated[Settings, Depends(get_settings)]) -> EmailProvider:
    return build_email_provider(settings)
