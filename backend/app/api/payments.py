import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.payments.base import PaymentProvider, WebhookError
from app.core.payments.registry import get_payment_provider
from app.schemas.orders import InitiatePayment, PaymentStatusRead
from app.services import payments as service

router = APIRouter(tags=["payments"])

Session = Annotated[AsyncSession, Depends(get_session)]
Provider = Annotated[PaymentProvider, Depends(get_payment_provider)]
AppSettings = Annotated[Settings, Depends(get_settings)]


# These two routes are public so guests can pay too. The (unguessable) order id is the
# capability; they reveal nothing beyond the order/payment status, and only the provider's
# verified answer ever changes state.
@router.post("/orders/{order_id}/pay", response_model=InitiatePayment)
async def pay(order_id: uuid.UUID, session: Session, provider: Provider, settings: AppSettings):
    """Start paying for an online order. Redirect the customer to `redirect_url`."""
    return await service.initiate_payment(session, provider, settings, order_id)


@router.post("/orders/{order_id}/payment/refresh", response_model=PaymentStatusRead)
async def refresh(order_id: uuid.UUID, session: Session, provider: Provider):
    """The customer returned from the gateway: verify with the provider and report the status."""
    return await service.refresh_payment(session, provider, order_id)


@router.post("/payments/webhook/{provider_name}")
async def webhook(
    provider_name: str,
    request: Request,
    session: Session,
    provider: Provider,
):
    """Provider notification. The signature is checked, then the provider is asked what really
    happened (the body is never trusted), so duplicates and forgeries are harmless."""
    if provider_name != provider.name:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown provider")
    body = await request.body()
    try:
        event = provider.parse_webhook(service.webhook_headers(request.headers), body)
    except WebhookError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid webhook") from None
    await service.handle_provider_event(session, provider, event.reference)
    return {"received": True}
