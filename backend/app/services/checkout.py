"""Quote and order creation. The backend is authoritative for price, stock, capacity, delivery
fee, total and delivery eligibility (CLAUDE.md §14, business-rules §10–13)."""

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import AuthUser
from app.core.config import Settings
from app.models.business_settings import BusinessSettings
from app.models.catalog import Product
from app.models.customer_data import Address
from app.models.enums import (
    ACTIVE_ORDER_STATUSES,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    ProductAvailability,
)
from app.models.orders import Order, OrderItem, Payment
from app.schemas.checkout import (
    MAX_LINE_QUANTITY,
    CartLine,
    Delivery,
    OrderCreate,
    OrderRead,
    Quote,
    QuoteLine,
)
from app.services import events
from app.services import orders as orders_service
from app.services.catalog import to_image
from app.services.customers import get_or_create_customer

# business-rules §13: online orders have a 30-minute payment window.
PAYMENT_WINDOW = timedelta(minutes=30)
DELIVERY_CITY = "Lahore"  # the only deliverable city (business-rules §10)


def _problem(status_code: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message, **extra})


def payment_methods(settings: Settings) -> list[PaymentMethod]:
    methods = [PaymentMethod.COD]
    if settings.online_payments_enabled:
        methods.append(PaymentMethod.ONLINE)
    return methods


def merge_lines(items: list[CartLine]) -> dict[uuid.UUID, int]:
    """Merge duplicate products (summing quantities), keeping first-seen order."""
    merged: dict[uuid.UUID, int] = {}
    for item in items:
        merged[item.product_id] = merged.get(item.product_id, 0) + item.quantity
    return merged


async def delivery_fee_paisa(session: AsyncSession) -> int:
    fee = await session.scalar(
        select(BusinessSettings.delivery_fee_paisa)
        .order_by(BusinessSettings.updated_at.desc())
        .limit(1)
    )
    return fee or 0


# ---- pricing -------------------------------------------------------------------------------


@dataclass
class PricedLine:
    product_id: uuid.UUID
    quantity: int
    product: Product | None
    issue: str | None = None
    max_quantity: int | None = None

    @property
    def line_total(self) -> int:
        assert self.product is not None
        return self.product.price_paisa * self.quantity


def _evaluate(product_id: uuid.UUID, quantity: int, product: Product | None) -> PricedLine:
    line = PricedLine(product_id, quantity, product)
    if product is None or not product.is_visible:
        line.product, line.issue = None, "NOT_FOUND"
        return line
    if product.availability_type == ProductAvailability.READY_TO_SHIP:
        available = product.stock_quantity
    else:
        assert product.active_units is not None
        available = product.max_active_units - product.active_units
    if available <= 0:
        line.issue = "UNAVAILABLE"
    elif quantity > available:
        line.issue, line.max_quantity = "EXCEEDS_AVAILABLE", available
    return line


async def _active_units(
    session: AsyncSession, product_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    stmt = (
        select(OrderItem.product_id, func.coalesce(func.sum(OrderItem.quantity), 0))
        .join(Order, Order.order_id == OrderItem.order_id)
        .where(OrderItem.product_id.in_(product_ids), Order.status.in_(ACTIVE_ORDER_STATUSES))
        .group_by(OrderItem.product_id)
    )
    return {pid: int(units) for pid, units in (await session.execute(stmt)).all()}


async def price_lines(
    session: AsyncSession, merged: dict[uuid.UUID, int], *, lock: bool
) -> list[PricedLine]:
    """Load and evaluate cart lines.

    With lock=True the product rows are locked (FOR UPDATE, in id order so concurrent checkouts
    cannot deadlock) until the transaction ends: this makes the stock/capacity checks and the
    reservation atomic.

    Active units are deliberately read by a SEPARATE statement AFTER the lock is held. In
    READ COMMITTED, a statement that waited on a row lock re-reads only the locked row; a
    subquery in the same statement would still use the older snapshot and miss the order a
    competing checkout just committed (overselling made-to-order capacity). A new statement
    gets a fresh snapshot that includes it.
    """
    stmt = (
        select(Product)
        .where(Product.product_id.in_(merged))
        .options(selectinload(Product.images))
        .order_by(Product.product_id)
        .execution_options(populate_existing=True)
    )
    if lock:
        stmt = stmt.with_for_update(of=Product)
    products = {p.product_id: p for p in (await session.scalars(stmt)).all()}
    units = await _active_units(session, list(products))
    for pid, product in products.items():
        product.active_units = units.get(pid, 0)
    return [_evaluate(pid, qty, products.get(pid)) for pid, qty in merged.items()]


def _totals(lines: list[PricedLine], fee: int) -> tuple[int, int, int]:
    subtotal = sum(line.line_total for line in lines if line.product and not line.issue)
    return subtotal, fee, subtotal + fee


async def quote(session: AsyncSession, items: list[CartLine], settings: Settings, url_for) -> Quote:
    merged = merge_lines(items)
    lines = await price_lines(session, merged, lock=False)
    fee = await delivery_fee_paisa(session)
    out: list[QuoteLine] = []
    for line in lines:
        p = line.product
        out.append(
            QuoteLine(
                product_id=line.product_id,
                quantity=line.quantity,
                name=p.name if p else None,
                unit_price_paisa=p.price_paisa if p else None,
                line_total_paisa=line.line_total if p else None,
                image=to_image(p.images[0], url_for) if p and p.images else None,
                issue=line.issue,
                max_quantity=line.max_quantity,
            )
        )
    ok = all(line.issue is None for line in lines)
    subtotal, fee, total = _totals(lines, fee)
    return Quote(
        lines=out,
        subtotal_paisa=subtotal,
        delivery_fee_paisa=fee,
        total_paisa=total,
        payment_methods=payment_methods(settings),
        can_checkout=ok and bool(lines),
    )


# ---- delivery ------------------------------------------------------------------------------


def _is_lahore(city: str) -> bool:
    return " ".join(city.split()).casefold() == DELIVERY_CITY.casefold()


async def resolve_delivery(
    session: AsyncSession, user: AuthUser | None, delivery: Delivery, contact_name: str
) -> dict[str, Any]:
    if delivery.address_id is not None:
        if user is None:
            raise _problem(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "ADDRESS_REQUIRES_LOGIN",
                "Saved addresses are only available when logged in",
            )
        # Ownership is part of the query: someone else's address is "not found".
        found = (
            await session.scalars(
                select(Address).where(
                    Address.address_id == delivery.address_id, Address.customer_id == user.id
                )
            )
        ).one_or_none()
        if found is None:
            raise _problem(status.HTTP_404_NOT_FOUND, "ADDRESS_NOT_FOUND", "Address not found")
        addr = {
            "house_no": found.house_no,
            "street_number": found.street_number,
            "city": found.city,
            "province": found.province,
            "postal_code": found.postal_code,
            "country": found.country,
        }
    else:
        assert delivery.address is not None
        a = delivery.address
        addr = {
            "house_no": a.house_no,
            "street_number": a.street_number,
            "city": a.city,
            "province": a.province,
            "postal_code": a.postal_code,
            "country": a.country,
        }
    # Server-side Lahore-only rule (business-rules §10). The city is stored canonically.
    if not _is_lahore(addr["city"]):
        raise _problem(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "NOT_DELIVERABLE",
            "We currently deliver only within Lahore",
        )
    addr["city"] = DELIVERY_CITY
    recipient = (delivery.recipient_name or "").strip() or contact_name
    return {
        "delivery_name": recipient,
        "delivery_house_no": addr["house_no"],
        "delivery_street_number": addr["street_number"],
        "delivery_city": addr["city"],
        "delivery_province": addr["province"],
        "delivery_postal_code": addr["postal_code"],
        "delivery_country": addr["country"],
    }


# ---- order creation ------------------------------------------------------------------------


async def expire_unpaid_orders(session: AsyncSession) -> int:
    """Run the database's expiry function (the single place that implements expiry; pg_cron
    calls the same function). Safe to call any time; commits its own transaction."""
    count = await session.scalar(text("SELECT expire_unpaid_online_orders()"))
    await session.commit()
    return count or 0


async def create_order(
    session: AsyncSession, user: AuthUser | None, data: OrderCreate, settings: Settings
) -> OrderRead:
    if data.payment_method not in payment_methods(settings):
        raise _problem(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "PAYMENT_METHOD_UNAVAILABLE",
            "This payment method is not available",
        )
    merged = merge_lines(data.items)
    if any(qty > MAX_LINE_QUANTITY for qty in merged.values()):
        raise _problem(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "QUANTITY_TOO_LARGE", "Too many units"
        )

    delivery = await resolve_delivery(session, user, data.delivery, data.contact.name)

    # Free stock held by orders whose payment window has passed, then re-check below.
    await expire_unpaid_orders(session)
    if user is not None:
        await get_or_create_customer(session, user)  # FK target; commits its own transaction

    try:
        # Everything from here to commit() is ONE transaction holding the product row locks.
        lines = await price_lines(session, merged, lock=True)
        problems = [line for line in lines if line.issue]
        if problems:
            raise _problem(
                status.HTTP_409_CONFLICT,
                "CHECKOUT_INVALID",
                "Some items are no longer available in the requested quantity",
                issues=[
                    {
                        "product_id": str(line.product_id),
                        "issue": line.issue,
                        "max_quantity": line.max_quantity,
                    }
                    for line in problems
                ],
            )

        fee = await delivery_fee_paisa(session)
        subtotal, fee, total = _totals(lines, fee)
        if data.expected_total_paisa is not None and data.expected_total_paisa != total:
            raise _problem(
                status.HTTP_409_CONFLICT,
                "TOTAL_CHANGED",
                "The total has changed. Please review your order.",
                total_paisa=total,
            )

        # Reserve ready-to-ship stock. Made-to-order capacity is reserved by the order itself
        # (active orders are what capacity is measured against). The CHECK constraint
        # stock_quantity >= 0 is the final backstop.
        for line in lines:
            assert line.product is not None
            if line.product.availability_type == ProductAvailability.READY_TO_SHIP:
                line.product.stock_quantity -= line.quantity

        online = data.payment_method == PaymentMethod.ONLINE
        order = Order(
            customer_id=user.id if user else None,
            customer_name=data.contact.name,
            customer_email=data.contact.email,
            customer_phone=data.contact.phone,
            status=OrderStatus.PENDING,
            subtotal_paisa=subtotal,
            delivery_fee_paisa=fee,
            total_amount_paisa=total,
            payment_deadline_at=(func.now() + PAYMENT_WINDOW) if online else None,
            **delivery,
        )
        order.items = [
            OrderItem(
                product_id=line.product_id,
                product_name_snapshot=line.product.name,  # type: ignore[union-attr]
                quantity=line.quantity,
                unit_price_at_purchase_paisa=line.product.price_paisa,  # type: ignore[union-attr]
            )
            for line in lines
        ]
        order.payments = [
            Payment(
                method=data.payment_method,
                status=PaymentStatus.PENDING,
                amount_paisa=total,
            )
        ]
        session.add(order)
        await session.flush()  # assigns order_id, which the notification and email mention
        await events.order_placed(session, order)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise _problem(
            status.HTTP_409_CONFLICT, "CHECKOUT_INVALID", "Could not reserve the items"
        ) from None
    except HTTPException:
        await session.rollback()
        raise

    return await orders_service.read_order(session, order.order_id)
