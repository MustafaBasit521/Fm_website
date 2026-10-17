import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.payments.base import PaymentProvider, WebhookError
from app.core.payments.registry import get_payment_provider
from app.core.rate_limit import rate_limit
from app.core.storage import SupabaseStorage, require_storage
from app.schemas.checkout import OrderRead
from app.schemas.engagement import IMAGE_TYPES, UploadRequest, UploadTarget
from app.schemas.orders import InitiatePayment, PaymentProofCreate, PaymentStatusRead
from app.services import orders as orders_service
from app.services import payments as service

router = APIRouter(tags=["payments"])

Session = Annotated[AsyncSession, Depends(get_session)]
Provider = Annotated[PaymentProvider, Depends(get_payment_provider)]
AppSettings = Annotated[Settings, Depends(get_settings)]


# These two routes are public so guests can pay too. The (unguessable) order id is the
# capability; they reveal nothing beyond the order/payment status, and only the provider's
# verified answer ever changes state.
@router.post(
    "/orders/{order_id}/pay",
    response_model=InitiatePayment,
    dependencies=[Depends(rate_limit("pay", 20, 3600))],
)
async def pay(order_id: uuid.UUID, session: Session, provider: Provider, settings: AppSettings):
    """Start paying for an online order. Redirect the customer to `redirect_url`."""
    return await service.initiate_payment(session, provider, settings, order_id)


@router.post(
    "/orders/{order_id}/payment/refresh",
    response_model=PaymentStatusRead,
    dependencies=[Depends(rate_limit("payment-refresh", 60, 60))],
)
async def refresh(order_id: uuid.UUID, session: Session, provider: Provider):
    """The customer returned from the gateway: verify with the provider and report the status."""
    return await service.refresh_payment(session, provider, order_id)


# Payment by transfer: the customer sends money to the shop's own account and then sends proof.
# Like paying online, these routes are public (guests too) and use the unguessable order id.
@router.post(
    "/orders/{order_id}/payment-proof/upload-url",
    response_model=UploadTarget,
    dependencies=[Depends(rate_limit("proof-upload", 10, 3600))],
)
async def proof_upload_url(
    order_id: uuid.UUID,
    data: UploadRequest,
    session: Session,
    storage: Annotated[SupabaseStorage, Depends(require_storage)],
):
    """A signed upload URL for ONE screenshot in the PRIVATE payment-proofs bucket."""
    await service.ensure_proof_can_be_sent(session, order_id)
    path = f"payment-proofs/{uuid.uuid4().hex}.{IMAGE_TYPES[data.content_type]}"
    signed = await storage.create_signed_upload(path, storage.payment_proofs_bucket)
    return UploadTarget(
        storage_path=signed.path,
        upload_url=signed.upload_url,
        token=signed.token,
        bucket=storage.payment_proofs_bucket,
    )


@router.post(
    "/orders/{order_id}/payment-proof",
    response_model=OrderRead,
    dependencies=[Depends(rate_limit("proof", 20, 3600))],
)
async def send_payment_proof(order_id: uuid.UUID, data: PaymentProofCreate, session: Session):
    """The customer says they sent the money (a transaction number, a screenshot, or both)."""
    return orders_service.to_read(await service.submit_transfer_proof(session, order_id, data))


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
