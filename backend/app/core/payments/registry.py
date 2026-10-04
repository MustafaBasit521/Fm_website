from functools import lru_cache
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.payments.base import PaymentProvider
from app.core.payments.fake import FakeProvider


@lru_cache
def _fake_provider(secret: str, frontend_url: str) -> FakeProvider:
    # One instance per process so the simulated gateway keeps its state between requests.
    return FakeProvider(webhook_secret=secret, frontend_url=frontend_url)


def get_payment_provider(settings: Annotated[Settings, Depends(get_settings)]) -> PaymentProvider:
    if settings.payment_provider == "fake":
        secret = (
            settings.payment_webhook_secret.get_secret_value()
            if settings.payment_webhook_secret
            else "dev-only-secret"
        )
        return _fake_provider(secret, settings.frontend_url)
    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Online payment is not available")
