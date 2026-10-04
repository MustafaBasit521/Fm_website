import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_session
from app.models.enums import OrderStatus, PaymentMethod
from app.schemas.catalog import Page
from app.schemas.checkout import Delivery
from app.schemas.orders import AdminCancel, AdminOrderRead, AdminOrderSummary, StatusChange
from app.services import catalog as catalog_service
from app.services import orders as service

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


@router.patch("/{order_id}/address", response_model=AdminOrderRead)
async def change_address(order_id: uuid.UUID, data: Delivery, session: Session):
    """For guests who contacted the shop (business-rules §16): same status rules as customers."""
    order = await service.change_address(session, order_id, data, user=None)
    return service.to_admin_read(order)
