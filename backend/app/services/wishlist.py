import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import AuthUser
from app.models.catalog import Product
from app.models.customer_data import WishlistItem
from app.services.customers import get_or_create_customer


async def list_wishlist(
    session: AsyncSession, user: AuthUser, page: int, page_size: int
) -> tuple[list[Product], int]:
    """The customer's wishlist, newest first. Hidden products are not shown (they are not
    purchasable), but their wishlist rows are kept in case the admin shows them again."""
    await get_or_create_customer(session, user)
    base = (
        select(Product)
        .join(WishlistItem, WishlistItem.product_id == Product.product_id)
        .where(WishlistItem.customer_id == user.id, Product.is_visible.is_(True))
    )
    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    stmt = (
        base.options(selectinload(Product.category), selectinload(Product.images))
        .order_by(WishlistItem.created_at.desc(), Product.product_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list((await session.scalars(stmt)).all()), total or 0


async def wishlist_product_ids(session: AsyncSession, user: AuthUser) -> list[uuid.UUID]:
    await get_or_create_customer(session, user)
    stmt = (
        select(WishlistItem.product_id)
        .join(Product, Product.product_id == WishlistItem.product_id)
        .where(WishlistItem.customer_id == user.id, Product.is_visible.is_(True))
    )
    return list((await session.scalars(stmt)).all())


async def add_to_wishlist(session: AsyncSession, user: AuthUser, product_id: uuid.UUID) -> None:
    await get_or_create_customer(session, user)
    visible = await session.scalar(
        select(Product.product_id).where(
            Product.product_id == product_id, Product.is_visible.is_(True)
        )
    )
    if visible is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    # ON CONFLICT keeps this safe under concurrent double-clicks; the primary key enforces
    # "cannot add the same product twice" (business-rules §25).
    result = await session.execute(
        insert(WishlistItem)
        .values(customer_id=user.id, product_id=product_id)
        .on_conflict_do_nothing()
        .returning(WishlistItem.product_id)
    )
    added = result.scalar_one_or_none()
    await session.commit()
    if added is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already in wishlist")


async def remove_from_wishlist(
    session: AsyncSession, user: AuthUser, product_id: uuid.UUID
) -> None:
    """Idempotent: removing something that is not there is not an error."""
    await session.execute(
        delete(WishlistItem).where(
            WishlistItem.customer_id == user.id, WishlistItem.product_id == product_id
        )
    )
    await session.commit()
