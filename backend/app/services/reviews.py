"""Product reviews (business-rules §26, database.md §13).

A customer may review a product only if they have a DELIVERED order containing it, once per
product, rating 1-5. Eligibility is enforced here on the server, never by the UI.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser
from app.models.catalog import Product
from app.models.customer import Customer
from app.models.engagement import Review
from app.models.enums import OrderStatus
from app.models.orders import Order, OrderItem
from app.schemas.engagement import (
    AdminReviewRead,
    MyReviewState,
    ReviewCreate,
    ReviewList,
    ReviewRead,
    ReviewUpdate,
)
from app.services.customers import get_or_create_customer

FORMER_CUSTOMER = "Former customer"


def _problem(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message})


def _first_name(name: str | None) -> str:
    if not name or not name.strip():
        return FORMER_CUSTOMER
    return name.split()[0]


def to_read(review: Review, customer_name: str | None) -> ReviewRead:
    return ReviewRead(
        review_id=review.review_id,
        product_id=review.product_id,
        rating=review.rating,
        comment=review.comment,
        author=_first_name(customer_name),
        created_at=review.created_at,
    )


async def _visible_product(session: AsyncSession, product_id: uuid.UUID) -> Product:
    product = (
        await session.scalars(
            select(Product).where(Product.product_id == product_id, Product.is_visible.is_(True))
        )
    ).one_or_none()
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    return product


async def _eligible_order_id(
    session: AsyncSession, customer_id: uuid.UUID, product_id: uuid.UUID
) -> uuid.UUID | None:
    """The customer's most recent Delivered order that contains this product."""
    return await session.scalar(
        select(Order.order_id)
        .join(OrderItem, OrderItem.order_id == Order.order_id)
        .where(
            Order.customer_id == customer_id,
            Order.status == OrderStatus.DELIVERED,
            OrderItem.product_id == product_id,
        )
        .order_by(Order.created_at.desc())
        .limit(1)
    )


async def _own_review(
    session: AsyncSession, customer_id: uuid.UUID, product_id: uuid.UUID
) -> Review | None:
    return (
        await session.scalars(
            select(Review).where(Review.customer_id == customer_id, Review.product_id == product_id)
        )
    ).one_or_none()


# ---- public --------------------------------------------------------------------------------


async def list_reviews(
    session: AsyncSession, product_id: uuid.UUID, page: int, page_size: int
) -> ReviewList:
    await _visible_product(session, product_id)
    stats = (
        await session.execute(
            select(func.count(), func.avg(Review.rating)).where(Review.product_id == product_id)
        )
    ).one()
    count, average = stats
    rows = (
        await session.execute(
            select(Review, Customer.name)
            .outerjoin(Customer, Customer.customer_id == Review.customer_id)
            .where(Review.product_id == product_id)
            .order_by(Review.created_at.desc(), Review.review_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return ReviewList(
        items=[to_read(review, name) for review, name in rows],
        total=count,
        page=page,
        page_size=page_size,
        average_rating=round(float(average), 1) if average is not None else None,
        rating_count=count,
    )


# ---- the signed-in customer ----------------------------------------------------------------


async def my_state(session: AsyncSession, user: AuthUser, product_id: uuid.UUID) -> MyReviewState:
    await _visible_product(session, product_id)
    customer = await get_or_create_customer(session, user)
    review = await _own_review(session, user.id, product_id)
    eligible = (
        review is not None or await _eligible_order_id(session, user.id, product_id) is not None
    )
    return MyReviewState(
        eligible=eligible, review=to_read(review, customer.name) if review else None
    )


async def create_review(
    session: AsyncSession, user: AuthUser, product_id: uuid.UUID, data: ReviewCreate
) -> ReviewRead:
    product = await _visible_product(session, product_id)
    customer = await get_or_create_customer(session, user)
    order_id = await _eligible_order_id(session, user.id, product_id)
    if order_id is None:
        raise _problem(
            status.HTTP_403_FORBIDDEN,
            "NOT_ELIGIBLE",
            "You can review a product only after an order containing it has been delivered",
        )
    review = Review(
        customer_id=user.id,
        product_id=product_id,
        order_id=order_id,
        product_name_snapshot=product.name,
        rating=data.rating,
        comment=data.comment,
    )
    session.add(review)
    try:
        await session.commit()  # UNIQUE(customer_id, product_id) settles any double-submit race
    except IntegrityError:
        await session.rollback()
        raise _problem(
            status.HTTP_409_CONFLICT, "ALREADY_REVIEWED", "You have already reviewed this product"
        ) from None
    return to_read(review, customer.name)


async def update_review(
    session: AsyncSession, user: AuthUser, product_id: uuid.UUID, data: ReviewUpdate
) -> ReviewRead:
    customer = await get_or_create_customer(session, user)
    review = await _own_review(session, user.id, product_id)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    for field in data.model_fields_set:
        setattr(review, field, getattr(data, field))
    await session.commit()
    return to_read(review, customer.name)


async def delete_own_review(session: AsyncSession, user: AuthUser, product_id: uuid.UUID) -> None:
    review = await _own_review(session, user.id, product_id)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    await session.delete(review)
    await session.commit()


# ---- admin ---------------------------------------------------------------------------------


async def list_admin_reviews(
    session: AsyncSession, product_id: uuid.UUID | None, page: int, page_size: int
) -> tuple[list[AdminReviewRead], int]:
    where = [Review.product_id == product_id] if product_id else []
    total = await session.scalar(select(func.count()).select_from(Review).where(*where))
    rows = (
        await session.execute(
            select(Review, Customer.name)
            .outerjoin(Customer, Customer.customer_id == Review.customer_id)
            .where(*where)
            .order_by(Review.created_at.desc(), Review.review_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items = [
        AdminReviewRead(
            **to_read(review, name).model_dump(),
            customer_id=review.customer_id,
            customer_name=name,
            order_id=review.order_id,
            product_name_snapshot=review.product_name_snapshot,
        )
        for review, name in rows
    ]
    return items, total or 0


async def admin_delete_review(session: AsyncSession, review_id: uuid.UUID) -> None:
    review = await session.get(Review, review_id)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    await session.delete(review)
    await session.commit()
