import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.db import get_session
from app.schemas.catalog import Page
from app.schemas.checkout import Delivery, OrderRead
from app.schemas.orders import OrderSummary
from app.services import catalog as catalog_service
from app.services import orders as service

# Order history for registered customers (guests have no website order lookup:
# business-rules §24). Every route needs a login and only ever reaches the caller's own orders.
router = APIRouter(prefix="/orders", tags=["orders"])

CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=Page[OrderSummary])
async def my_orders(
    user: CurrentUser,
    session: Session,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 10,
):
    rows, total = await service.list_customer_orders(session, user, page, page_size)
    return catalog_service.paginate([service.to_summary(o) for o in rows], total, page, page_size)


@router.get("/{order_id}", response_model=OrderRead)
async def my_order(order_id: uuid.UUID, user: CurrentUser, session: Session):
    return service.to_read(await service.get_customer_order(session, user, order_id))


@router.post("/{order_id}/cancel", response_model=OrderRead)
async def cancel_my_order(order_id: uuid.UUID, user: CurrentUser, session: Session):
    """Pending/Confirmed only. From Processing the customer must contact the shop."""
    return service.to_read(await service.cancel_order(session, order_id, user=user))


@router.patch("/{order_id}/address", response_model=OrderRead)
async def change_my_order_address(
    order_id: uuid.UUID, data: Delivery, user: CurrentUser, session: Session
):
    return service.to_read(await service.change_address(session, order_id, data, user=user))
