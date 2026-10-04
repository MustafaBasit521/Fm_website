import logging
from typing import Annotated

from fastapi import Depends

from app.core.config import Settings, get_settings
from app.core.email.base import EmailMessage, EmailProvider

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


def build_email_provider(settings: Settings) -> EmailProvider:
    return ConsoleEmailProvider() if settings.email_provider == "console" else NullEmailProvider()


def get_email_provider(settings: Annotated[Settings, Depends(get_settings)]) -> EmailProvider:
    return build_email_provider(settings)
