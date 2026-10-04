"""Order history, status transitions, cancellation and address changes
(business-rules §14–19, database.md §9, §23)."""

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, exists, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import AuthUser
from app.models.enums import OrderStatus, PaymentMethod, PaymentStatus
from app.models.orders import Order, Payment
from app.schemas.checkout import Delivery, OrderItemRead, OrderRead
from app.schemas.orders import AdminOrderRead, AdminOrderSummary, OrderSummary

# Normal lifecycle (business-rules §14). Cancellation is separate: it is a terminal state.
NEXT_STATUS: dict[OrderStatus, OrderStatus] = {
    OrderStatus.PENDING: OrderStatus.CONFIRMED,
    OrderStatus.CONFIRMED: OrderStatus.PROCESSING,
    OrderStatus.PROCESSING: OrderStatus.SHIPPED,
    OrderStatus.SHIPPED: OrderStatus.DELIVERED,
}
# Statuses in which a registered customer may cancel / change the address (§15, §16).
CUSTOMER_EDITABLE = (OrderStatus.PENDING, OrderStatus.CONFIRMED)
CHARGE_NUMERATOR, CHARGE_DENOMINATOR = 1, 2  # 50% (§18)


def _problem(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message})


# ---- mapping -------------------------------------------------------------------------------


def _current_payment(order: Order) -> Payment:
    # Orders have one payment row today; with retries the latest row is the current one.
    return order.payments[-1]


def refund_due(order: Order) -> int:
    payment = _current_payment(order)
    if order.status != OrderStatus.CANCELLED:
        return 0
    if payment.status not in (PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED):
        return 0  # nothing was collected, so nothing is owed back
    return max(
        payment.amount_paisa - order.cancellation_charge_paisa - payment.refunded_amount_paisa, 0
    )


def to_read(order: Order) -> OrderRead:
    payment = _current_payment(order)
    return OrderRead(
        order_id=order.order_id,
        status=order.status,
        payment_method=payment.method,
        payment_status=payment.status,
        payment_deadline_at=order.payment_deadline_at,
        customer_name=order.customer_name,
        customer_email=order.customer_email,
        customer_phone=order.customer_phone,
        delivery_name=order.delivery_name,
        delivery_house_no=order.delivery_house_no,
        delivery_street_number=order.delivery_street_number,
        delivery_city=order.delivery_city,
        delivery_province=order.delivery_province,
        delivery_postal_code=order.delivery_postal_code,
        delivery_country=order.delivery_country,
        items=[OrderItemRead.model_validate(i) for i in order.items],
        subtotal_paisa=order.subtotal_paisa,
        delivery_fee_paisa=order.delivery_fee_paisa,
        total_amount_paisa=order.total_amount_paisa,
        created_at=order.created_at,
        cancelled_at=order.cancelled_at,
        cancellation_charge_paisa=order.cancellation_charge_paisa,
        charge_waived=order.charge_waived,
        refund_due_paisa=refund_due(order),
    )


def to_admin_read(order: Order) -> AdminOrderRead:
    return AdminOrderRead(
        **to_read(order).model_dump(), customer_id=order.customer_id, updated_at=order.updated_at
    )


def _summary_fields(order: Order) -> dict[str, Any]:
    payment = _current_payment(order)
    return {
        "order_id": order.order_id,
        "status": order.status,
        "payment_method": payment.method,
        "payment_status": payment.status,
        "total_amount_paisa": order.total_amount_paisa,
        "item_count": sum(i.quantity for i in order.items),
        "payment_deadline_at": order.payment_deadline_at,
        "created_at": order.created_at,
    }


def to_summary(order: Order) -> OrderSummary:
    return OrderSummary(**_summary_fields(order))


def to_admin_summary(order: Order) -> AdminOrderSummary:
    return AdminOrderSummary(
        **_summary_fields(order),
        customer_name=order.customer_name,
        customer_email=order.customer_email,
    )


# ---- loading -------------------------------------------------------------------------------

_LOAD = (selectinload(Order.items), selectinload(Order.payments))


async def read_order(session: AsyncSession, order_id: uuid.UUID) -> OrderRead:
    order = await _get(session, order_id, lock=False)
    return to_read(order)


async def _get(session: AsyncSession, order_id: uuid.UUID, *, lock: bool) -> Order:
    stmt = (
        select(Order)
        .where(Order.order_id == order_id)
        .options(*_LOAD)
        .execution_options(populate_existing=True)
    )
    if lock:
        # Serializes concurrent changes to one order (customer cancel vs admin status change
        # vs expiry). The state checks below run only after the lock is held.
        stmt = stmt.with_for_update(of=Order)
    order = (await session.scalars(stmt)).one_or_none()
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


def _own(order: Order, user: AuthUser) -> Order:
    # Someone else's order is simply "not found" (existence is not revealed).
    if order.customer_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


# ---- customer: history ---------------------------------------------------------------------


async def list_customer_orders(
    session: AsyncSession, user: AuthUser, page: int, page_size: int
) -> tuple[list[Order], int]:
    where = Order.customer_id == user.id
    total = await session.scalar(select(func.count()).select_from(Order).where(where))
    stmt = (
        select(Order)
        .where(where)
        .options(*_LOAD)
        .order_by(Order.created_at.desc(), Order.order_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list((await session.scalars(stmt)).all()), total or 0


async def get_customer_order(session: AsyncSession, user: AuthUser, order_id: uuid.UUID) -> Order:
    return _own(await _get(session, order_id, lock=False), user)


# ---- cancellation (business-rules §15, §18, §19) -------------------------------------------


def cancellation_terms(order: Order, *, by_admin: bool, waive: bool) -> tuple[int, bool]:
    """Return (charge_paisa, charge_waived) for cancelling the order now, or raise."""
    st = order.status
    if st in CUSTOMER_EDITABLE:
        return 0, False
    if st == OrderStatus.PROCESSING:
        if not by_admin:
            raise _problem(
                status.HTTP_409_CONFLICT,
                "CONTACT_SHOP",
                "This order is being prepared. Please contact the shop to cancel it.",
            )
        payment = _current_payment(order)
        unpaid = payment.method == PaymentMethod.COD or payment.status == PaymentStatus.PENDING
        if unpaid or waive:
            # COD not yet collected: nothing to charge (§18). Or the admin waived it.
            return 0, True
        # 50% of the original total including the delivery fee, rounded down.
        return order.total_amount_paisa * CHARGE_NUMERATOR // CHARGE_DENOMINATOR, False
    raise _problem(
        status.HTTP_409_CONFLICT, "CANNOT_CANCEL", "This order can no longer be cancelled"
    )


async def cancel_order(
    session: AsyncSession, order_id: uuid.UUID, *, user: AuthUser | None, waive: bool = False
) -> Order:
    """Cancel an order. With a customer `user` it must be their own and still Pending/Confirmed;
    with user=None the caller is an authorized admin."""
    order = await _get(session, order_id, lock=True)
    if user is not None:
        _own(order, user)
    charge, waived = cancellation_terms(order, by_admin=user is None, waive=waive)
    order.status = OrderStatus.CANCELLED
    order.cancelled_at = func.now()
    order.cancellation_charge_paisa = charge
    order.charge_waived = waived
    await session.flush()
    # Same function the payment-window expiry uses: ready-to-ship stock returns, and
    # made-to-order capacity frees itself because the order is no longer active.
    await session.execute(text("SELECT release_order_stock(:id)"), {"id": order.order_id})
    await session.commit()
    return await _get(session, order_id, lock=False)


# ---- address change (business-rules §16) ---------------------------------------------------


async def change_address(
    session: AsyncSession,
    order_id: uuid.UUID,
    delivery: Delivery,
    *,
    user: AuthUser | None,
) -> Order:
    from app.services.checkout import resolve_delivery  # avoid a circular import

    order = await _get(session, order_id, lock=True)
    if user is not None:
        _own(order, user)
    if order.status not in CUSTOMER_EDITABLE:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "ADDRESS_LOCKED",
            "The delivery address can no longer be changed for this order",
        )
    # Same Lahore-only rule and saved-address ownership checks as checkout. Without a new
    # recipient name the existing one is kept.
    snapshot = await resolve_delivery(session, user, delivery, order.delivery_name)
    for field, value in snapshot.items():
        setattr(order, field, value)
    await session.commit()
    return await _get(session, order_id, lock=False)


# ---- admin ---------------------------------------------------------------------------------


async def list_admin_orders(
    session: AsyncSession,
    *,
    order_status: OrderStatus | None,
    payment_method: PaymentMethod | None,
    search: str | None,
    page: int,
    page_size: int,
) -> tuple[list[Order], int]:
    conditions: list[ColumnElement[bool]] = []
    if order_status:
        conditions.append(Order.status == order_status)
    if payment_method:
        conditions.append(
            exists().where(Payment.order_id == Order.order_id, Payment.method == payment_method)
        )
    if search and search.strip():
        term = search.strip()
        like = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        matches = [
            Order.customer_name.ilike(like, escape="\\"),
            Order.customer_email.ilike(like, escape="\\"),
        ]
        try:
            matches.append(Order.order_id == uuid.UUID(term))
        except ValueError:
            pass
        conditions.append(or_(*matches))
    total = await session.scalar(select(func.count()).select_from(Order).where(*conditions))
    stmt = (
        select(Order)
        .where(*conditions)
        .options(*_LOAD)
        .order_by(Order.created_at.desc(), Order.order_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list((await session.scalars(stmt)).all()), total or 0


async def get_admin_order(session: AsyncSession, order_id: uuid.UUID) -> Order:
    return await _get(session, order_id, lock=False)


async def advance_status(session: AsyncSession, order_id: uuid.UUID, target: OrderStatus) -> Order:
    """Move an order one step forward in the normal lifecycle (admin only)."""
    order = await _get(session, order_id, lock=True)
    if target == OrderStatus.CANCELLED:
        raise _problem(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "USE_CANCEL",
            "Use the cancel action to cancel an order",
        )
    if NEXT_STATUS.get(order.status) != target:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "INVALID_TRANSITION",
            f"An order cannot move from {order.status} to {target}",
        )
    payment = _current_payment(order)
    if (
        target == OrderStatus.CONFIRMED
        and payment.method == PaymentMethod.ONLINE
        and payment.status != PaymentStatus.PAID
    ):
        # business-rules §13: an online order is never confirmed before verified payment.
        raise _problem(
            status.HTTP_409_CONFLICT,
            "PAYMENT_NOT_VERIFIED",
            "An online order cannot be confirmed before its payment is verified",
        )
    order.status = target
    await session.commit()
    return await _get(session, order_id, lock=False)
