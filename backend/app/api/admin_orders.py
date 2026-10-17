import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_session
from app.core.payments.base import PaymentProvider
from app.core.payments.registry import get_optional_payment_provider
from app.core.storage import StorageNotConfiguredError, SupabaseStorage, get_storage
from app.models.enums import OrderStatus, PaymentMethod
from app.schemas.catalog import Page
from app.schemas.orders import (
    AdminCancel,
    AdminOrderRead,
    AdminOrderSummary,
    AdminProofImage,
    RefundRequest,
    StatusChange,
)
from app.services import catalog as catalog_service
from app.services import orders as service
from app.services import payments as payments_service

router = APIRouter(
    prefix="/admin/orders", tags=["admin-orders"], dependencies=[Depends(require_admin)]
)

Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=Page[AdminOrderSummary])
async def list_orders(
    session: Session,
    status: OrderStatus | None = None,
    payment_method: PaymentMethod | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    rows, total = await service.list_admin_orders(
        session,
        order_status=status,
        payment_method=payment_method,
        search=search,
        page=page,
        page_size=page_size,
    )
    items = [service.to_admin_summary(o) for o in rows]
    return catalog_service.paginate(items, total, page, page_size)


@router.get("/{order_id}", response_model=AdminOrderRead)
async def get_order(order_id: uuid.UUID, session: Session):
    return service.to_admin_read(await service.get_admin_order(session, order_id))


@router.post("/{order_id}/status", response_model=AdminOrderRead)
async def change_status(order_id: uuid.UUID, data: StatusChange, session: Session):
    """Move one step forward: Pending -> Confirmed -> Processing -> Shipped -> Delivered."""
    return service.to_admin_read(await service.advance_status(session, order_id, data.status))


@router.post("/{order_id}/cancel", response_model=AdminOrderRead)
async def cancel_order(order_id: uuid.UUID, data: AdminCancel, session: Session):
    """Cancel from Pending/Confirmed/Processing (Processing may carry the 50% charge)."""
    order = await service.cancel_order(session, order_id, user=None, waive=data.waive_charge)
    return service.to_admin_read(order)


@router.post("/{order_id}/confirm-cod-payment", response_model=AdminOrderRead)
async def confirm_cod_payment(order_id: uuid.UUID, session: Session):
    """The cash was received on delivery: COD payment becomes Paid (business-rules §20)."""
    await payments_service.confirm_cod_payment(session, order_id)
    return service.to_admin_read(await service.get_admin_order(session, order_id))


@router.post("/{order_id}/confirm-transfer", response_model=AdminOrderRead)
async def confirm_transfer(order_id: uuid.UUID, session: Session):
    """The money arrived in the shop's account: the payment is Paid and the order Confirmed."""
    return service.to_admin_read(await payments_service.confirm_transfer(session, order_id))


@router.post("/{order_id}/reject-transfer-proof", response_model=AdminOrderRead)
async def reject_transfer_proof(order_id: uuid.UUID, session: Session):
    """The money was not found: the customer gets a fresh 30 minutes to send correct details."""
    return service.to_admin_read(await payments_service.reject_transfer_proof(session, order_id))


@router.get("/{order_id}/payment-proof-image", response_model=AdminProofImage)
async def payment_proof_image(
    order_id: uuid.UUID, session: Session, storage: Annotated[SupabaseStorage, Depends(get_storage)]
):
    """A temporary link to the customer's screenshot (None if they sent only a number)."""
    order = await service.get_admin_order(session, order_id)
    payment = next((p for p in order.payments if p.proof_image_path), None)
    if payment is None or payment.proof_image_path is None:
        return AdminProofImage(url=None)
    try:
        url = await storage.create_signed_download(
            payment.proof_image_path, storage.payment_proofs_bucket
        )
    except StorageNotConfiguredError:
        url = None
    return AdminProofImage(url=url)


@router.post("/{order_id}/refund", response_model=AdminOrderRead)
async def refund(
    order_id: uuid.UUID,
    data: RefundRequest,
    session: Session,
    provider: Annotated[PaymentProvider | None, Depends(get_optional_payment_provider)],
):
    """Refund all or part of what a cancelled, paid order still owes the customer. Online: the
    provider returns the money. Transfer: the shop returned it itself and this records it."""
    await payments_service.refund_order(session, provider, order_id, data.amount_paisa)
    return service.to_admin_read(await service.get_admin_order(session, order_id))
