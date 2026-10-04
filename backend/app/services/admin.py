"""Admin dashboard, customer management and business settings (business-rules §32–33)."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.business_settings import BusinessSettings
from app.models.catalog import Category, Product
from app.models.customer import Customer
from app.models.engagement import CustomOrder, Message
from app.models.enums import (
    CustomOrderStatus,
    MessageStatus,
    OrderStatus,
    PaymentMethod,
    ProductAvailability,
)
from app.models.orders import Order, Payment
from app.schemas.admin import (
    AdminCategory,
    AdminCustomer,
    AdminCustomerDetail,
    DashboardSummary,
    LowStockProduct,
    SettingsUpdate,
)
from app.services import orders as orders_service

LOW_STOCK_THRESHOLD = 3  # a technical default for the "running low" list
_LOAD = (selectinload(Order.items), selectinload(Order.payments))


# ---- dashboard -----------------------------------------------------------------------------


async def dashboard(session: AsyncSession) -> DashboardSummary:
    by_status = {s.value: 0 for s in OrderStatus}
    rows = await session.execute(select(Order.status, func.count()).group_by(Order.status))
    for order_status, count in rows.all():
        by_status[order_status.value] = count

    pending_cod = (
        select(func.count())
        .select_from(Order)
        .where(
            Order.status == OrderStatus.PENDING,
            exists().where(Payment.order_id == Order.order_id, Payment.method == PaymentMethod.COD),
        )
    )
    needing_action = (await session.scalar(pending_cod) or 0) + by_status[
        OrderStatus.CONFIRMED.value
    ]

    new_messages = await session.scalar(
        select(func.count()).select_from(Message).where(Message.status == MessageStatus.NEW)
    )
    new_custom = await session.scalar(
        select(func.count())
        .select_from(CustomOrder)
        .where(CustomOrder.status == CustomOrderStatus.NEW)
    )
    low = (
        await session.execute(
            select(Product.product_id, Product.name, Product.stock_quantity)
            .where(
                Product.availability_type == ProductAvailability.READY_TO_SHIP,
                Product.stock_quantity <= LOW_STOCK_THRESHOLD,
            )
            .order_by(Product.stock_quantity, Product.name)
            .limit(10)
        )
    ).all()
    recent = (
        await session.scalars(
            select(Order).options(*_LOAD).order_by(Order.created_at.desc(), Order.order_id).limit(5)
        )
    ).all()
    return DashboardSummary(
        orders_by_status=by_status,
        orders_needing_action=needing_action,
        new_messages=new_messages or 0,
        new_custom_orders=new_custom or 0,
        low_stock_threshold=LOW_STOCK_THRESHOLD,
        low_stock_products=[
            LowStockProduct(product_id=pid, name=name, stock_quantity=stock)
            for pid, name, stock in low
        ],
        recent_orders=[orders_service.to_admin_summary(o) for o in recent],
    )


# ---- customers -----------------------------------------------------------------------------


def _order_count_subquery():
    return (
        select(func.count())
        .select_from(Order)
        .where(Order.customer_id == Customer.customer_id)
        .correlate(Customer)
        .scalar_subquery()
    )


async def list_customers(
    session: AsyncSession, *, search: str | None, page: int, page_size: int
) -> tuple[list[AdminCustomer], int]:
    where: list[ColumnElement[bool]] = []
    if search and search.strip():
        like = (
            "%" + search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        )
        where.append(
            or_(Customer.name.ilike(like, escape="\\"), Customer.email.ilike(like, escape="\\"))
        )
    total = await session.scalar(select(func.count()).select_from(Customer).where(*where))
    rows = (
        await session.execute(
            select(Customer, _order_count_subquery())
            .where(*where)
            .order_by(Customer.created_at.desc(), Customer.customer_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items = [
        AdminCustomer(
            customer_id=c.customer_id,
            name=c.name,
            email=c.email,
            phone=c.phone,
            subscribed_to_updates=c.subscribed_to_updates,
            created_at=c.created_at,
            order_count=count,
        )
        for c, count in rows
    ]
    return items, total or 0


async def get_customer(session: AsyncSession, customer_id: uuid.UUID) -> AdminCustomerDetail:
    row = (
        await session.execute(
            select(Customer, _order_count_subquery()).where(Customer.customer_id == customer_id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    customer, order_count = row
    custom_count = await session.scalar(
        select(func.count()).select_from(CustomOrder).where(CustomOrder.customer_id == customer_id)
    )
    recent = (
        await session.scalars(
            select(Order)
            .where(Order.customer_id == customer_id)
            .options(*_LOAD)
            .order_by(Order.created_at.desc(), Order.order_id)
            .limit(10)
        )
    ).all()
    return AdminCustomerDetail(
        customer_id=customer.customer_id,
        name=customer.name,
        email=customer.email,
        phone=customer.phone,
        subscribed_to_updates=customer.subscribed_to_updates,
        created_at=customer.created_at,
        order_count=order_count,
        custom_order_count=custom_count or 0,
        recent_orders=[orders_service.to_admin_summary(o) for o in recent],
    )


# ---- categories (with product counts) ------------------------------------------------------


async def list_categories(session: AsyncSession) -> list[AdminCategory]:
    count = (
        select(func.count())
        .select_from(Product)
        .where(Product.category_id == Category.category_id)
        .correlate(Category)
        .scalar_subquery()
    )
    rows = (await session.execute(select(Category, count).order_by(Category.name))).all()
    return [AdminCategory(category_id=c.category_id, name=c.name, product_count=n) for c, n in rows]


# ---- business settings ---------------------------------------------------------------------


async def get_settings_row(session: AsyncSession) -> BusinessSettings:
    """The single active settings record (created on demand if somehow missing)."""
    row = (
        await session.scalars(
            select(BusinessSettings).order_by(BusinessSettings.updated_at.desc()).limit(1)
        )
    ).one_or_none()
    if row is None:
        row = BusinessSettings(delivery_fee_paisa=0)
        session.add(row)
        await session.commit()
    return row


async def update_settings(session: AsyncSession, data: SettingsUpdate) -> BusinessSettings:
    row = await get_settings_row(session)
    for field in data.model_fields_set:
        value = getattr(data, field)
        if field == "delivery_fee_paisa" and value is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "delivery_fee_paisa cannot be null"
            )
        if field == "social_links":
            value = value or {}
        setattr(row, field, value)
    await session.commit()
    await session.refresh(row)
    return row
