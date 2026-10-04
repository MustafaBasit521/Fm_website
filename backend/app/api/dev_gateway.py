"""Development-only simulator for the fake payment gateway. This router is registered only when
PAYMENT_PROVIDER=fake, which Settings refuses in production."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.payments.base import PaymentProvider, ProviderError, ProviderStatus
from app.core.payments.fake import FakeProvider
from app.core.payments.registry import get_payment_provider
from app.services import payments as service

router = APIRouter(prefix="/dev/fake-gateway", tags=["dev-only"])


class Outcome(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal["paid", "failed"]


@router.post("/{reference}/complete")
async def complete(
    reference: str,
    data: Outcome,
    session: Annotated[AsyncSession, Depends(get_session)],
    provider: Annotated[PaymentProvider, Depends(get_payment_provider)],
):
    """Pretend the customer paid (or failed to pay) at the gateway, then deliver the webhook the
    way a real gateway would."""
    assert isinstance(provider, FakeProvider)
    try:
        provider.complete(
            reference, ProviderStatus.PAID if data.outcome == "paid" else ProviderStatus.FAILED
        )
    except ProviderError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown payment reference") from None
    await service.handle_provider_event(session, provider, reference)
    return {"received": True}
