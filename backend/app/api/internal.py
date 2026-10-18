"""Routes called by a scheduler, not by browsers. They are protected by a shared secret."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.services import expiry

router = APIRouter(prefix="/internal", tags=["internal"])

Session = Annotated[AsyncSession, Depends(get_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def require_cron_secret(
    settings: AppSettings, x_cron_secret: Annotated[str | None, Header()] = None
) -> None:
    if settings.cron_secret is None:  # not configured: the route does not exist
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    expected = settings.cron_secret.get_secret_value().encode()
    if x_cron_secret is None or not hmac.compare_digest(x_cron_secret.encode(), expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid secret")


@router.post("/expire-orders", dependencies=[Depends(require_cron_secret)])
async def expire_orders(session: Session):
    """Cancel unpaid orders whose payment window ran out, return their stock and tell each
    customer once. Safe to call as often as you like (every few minutes)."""
    return await expiry.expire_and_notify(session)
