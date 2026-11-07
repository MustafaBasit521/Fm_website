"""Feature switches enforced on the server (CLAUDE.md §2: the backend is authoritative).

Hiding a button in the UI is not enough: a switched-off feature must also refuse its API routes,
with a clear error, so nobody can reach it by calling the API directly.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.core.config import Settings, get_settings


def _disabled(message: str) -> HTTPException:
    return HTTPException(
        status.HTTP_403_FORBIDDEN, {"code": "FEATURE_DISABLED", "message": message}
    )


def require_manual_receipts(settings: Annotated[Settings, Depends(get_settings)]) -> None:
    """Receipt upload, submissions and the admin Payments queue (MANUAL_RECEIPTS_ENABLED)."""
    if not settings.manual_receipts_enabled:
        raise _disabled("Sending payment receipts through the website is switched off.")


def require_online_payments(settings: Annotated[Settings, Depends(get_settings)]) -> None:
    """The payment-gateway routes (ONLINE_PAYMENTS_ENABLED)."""
    if not settings.online_payments_enabled:
        raise _disabled("Online card payment is switched off.")
