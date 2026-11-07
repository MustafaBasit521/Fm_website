import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, require_admin
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.payments.base import PaymentProvider
from app.core.payments.registry import get_optional_payment_provider
from app.models.enums import OrderStatus, PaymentMethod
from app.schemas.catalog import Page
from app.schemas.orders import (
    AdminCancel,
    AdminOrderRead,
    AdminOrderSummary,
    RefundRequest,
    StatusChange,
)
from app.schemas.payments import MarkPaid
from app.services import catalog as catalog_service
from app.services import orders as service
from app.services import payments as payments_service

router = APIRouter(
    prefix="/admin/orders", tags=["admin-orders"], dependencies=[Depends(require_admin)]
)

Session = Annotated[AsyncSession, Depends(get_session)]
Admin = Annotated[AuthUser, Depends(require_admin)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.get("", response_model=Page[AdminOrderSummary])
async def list_orders(
    session: Session,
    status: OrderStatus | None = None,
    payment_method: PaymentMethod | None = None,
    awaiting_payment: bool = False,
    search: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    rows, total = await service.list_admin_orders(
        session,
        order_status=status,
        payment_method=payment_method,
        awaiting_payment=awaiting_payment,
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


@router.post("/{order_id}/mark-paid", response_model=AdminOrderRead)
async def mark_paid(
    order_id: uuid.UUID, data: MarkPaid, session: Session, admin: Admin, settings: AppSettings
):
    """Easypaisa / JazzCash: the admin saw the full amount in the shop's own wallet app. The
    payment becomes Paid and the order Confirmed (business-rules §13). Once only."""
    await payments_service.mark_wallet_paid(session, settings, order_id, admin.id, data)
    return service.to_admin_read(await service.get_admin_order(session, order_id))


@router.post("/{order_id}/refund", response_model=AdminOrderRead)
async def refund(
    order_id: uuid.UUID,
    data: RefundRequest,
    session: Session,
    admin: Admin,
    provider: Annotated[PaymentProvider | None, Depends(get_optional_payment_provider)],
):
    """Refund all or part of what a cancelled, paid order still owes the customer. Online: the
    provider returns the money. Easypaisa / JazzCash: the shop returned it itself and this records
    it (with the wallet transaction number, if given)."""
    await payments_service.refund_order(
        session,
        provider,
        order_id,
        data.amount_paisa,
        admin_id=admin.id,
        wallet_reference=data.wallet_reference,
    )
    return service.to_admin_read(await service.get_admin_order(session, order_id))
