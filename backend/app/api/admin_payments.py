"""The admin's payment queue for Easypaisa / JazzCash: see what customers submitted, check the
shop's own wallet account, then verify or reject. Every route needs the admin role (and the second
factor); the admin id comes from the verified token, never from the request."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, require_admin
from app.core.db import get_session
from app.core.features import require_manual_receipts
from app.core.storage import StorageNotConfiguredError, SupabaseStorage, get_storage
from app.models.enums import PaymentAttemptStatus
from app.schemas.catalog import Page
from app.schemas.payments import AdminPaymentAttempt, PaymentReject, ReceiptLink
from app.services import catalog as catalog_service
from app.services import payments as service

# The admin check comes first, so a visitor gets 401/403 and only an admin learns that the receipt
# flow is switched off (MANUAL_RECEIPTS_ENABLED).
router = APIRouter(
    prefix="/admin/payments",
    tags=["admin-payments"],
    dependencies=[Depends(require_admin), Depends(require_manual_receipts)],
)

Session = Annotated[AsyncSession, Depends(get_session)]
Admin = Annotated[AuthUser, Depends(require_admin)]


@router.get("", response_model=Page[AdminPaymentAttempt])
async def list_payments(
    session: Session,
    status: PaymentAttemptStatus | None = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = await service.list_attempts(
        session, attempt_status=status, page=page, page_size=page_size
    )
    return catalog_service.paginate(items, total, page, page_size)


@router.get("/{attempt_id}", response_model=AdminPaymentAttempt)
async def get_payment(attempt_id: uuid.UUID, session: Session):
    return await service.get_attempt(session, attempt_id)


@router.get("/{attempt_id}/receipt", response_model=ReceiptLink)
async def receipt(
    attempt_id: uuid.UUID,
    session: Session,
    storage: Annotated[SupabaseStorage, Depends(get_storage)],
):
    """A temporary link to the receipt screenshot (the bucket is private)."""
    path = await service.receipt_path(session, attempt_id)
    try:
        url = await storage.create_signed_download(path, storage.payment_proofs_bucket)
    except StorageNotConfiguredError:
        url = None
    return ReceiptLink(url=url)


@router.post("/{attempt_id}/verify", response_model=AdminPaymentAttempt)
async def verify(attempt_id: uuid.UUID, session: Session, admin: Admin):
    """The money is in the shop's wallet: payment Paid, order Confirmed. Only once."""
    await service.verify_attempt(session, attempt_id, admin.id)
    return await service.get_attempt(session, attempt_id)


@router.post("/{attempt_id}/reject", response_model=AdminPaymentAttempt)
async def reject(attempt_id: uuid.UUID, data: PaymentReject, session: Session, admin: Admin):
    """Not accepted: a reason is required. The customer can send corrected details."""
    await service.reject_attempt(session, attempt_id, admin.id, data)
    return await service.get_attempt(session, attempt_id)
