import uuid
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, Select, and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_expression

from app.models.catalog import Category, Product, ProductImage
from app.models.enums import ACTIVE_ORDER_STATUSES, ProductAvailability
from app.models.orders import Order, OrderItem
from app.schemas.catalog import (
    AdminProduct,
    CategoryRead,
    CategoryWrite,
    ImageCreate,
    ImageUpdate,
    Page,
    ProductCreate,
    ProductDetail,
    ProductImageRead,
    ProductSummary,
    ProductUpdate,
    SortKey,
    storage_path_pattern,
)

UrlFor = Callable[[str], str]

# ---- availability (business-rules §1, database.md §24) ------------------------------------


def active_units_expr() -> ColumnElement[int]:
    """Units currently held by active (Pending/Confirmed/Processing) orders, per product."""
    return (
        select(func.coalesce(func.sum(OrderItem.quantity), 0))
        .select_from(OrderItem)
        .join(Order, Order.order_id == OrderItem.order_id)
        .where(OrderItem.product_id == Product.product_id, Order.status.in_(ACTIVE_ORDER_STATUSES))
        .correlate(Product)
        .scalar_subquery()
    )


def availability_expr() -> ColumnElement[bool]:
    ready = and_(
        Product.availability_type == ProductAvailability.READY_TO_SHIP, Product.stock_quantity > 0
    )
    made = and_(
        Product.availability_type == ProductAvailability.MADE_TO_ORDER,
        Product.max_active_units - active_units_expr() > 0,
    )
    return or_(ready, made)


def is_available(product: Product) -> bool:
    if product.availability_type == ProductAvailability.READY_TO_SHIP:
        return product.stock_quantity > 0
    if product.active_units is None:  # a query forgot with_expression(): fail loudly
        raise RuntimeError("Product.active_units was not loaded")
    return product.max_active_units - product.active_units > 0


# ---- mapping -------------------------------------------------------------------------------


def to_image(img: ProductImage, url_for: UrlFor) -> ProductImageRead:
    return ProductImageRead(
        image_id=img.image_id,
        url=url_for(img.storage_path),
        alt_text=img.alt_text,
        sort_order=img.sort_order,
    )


def to_summary(p: Product, url_for: UrlFor) -> ProductSummary:
    return ProductSummary(
        product_id=p.product_id,
        name=p.name,
        price_paisa=p.price_paisa,
        category=CategoryRead.model_validate(p.category),
        availability_type=p.availability_type,
        is_available=is_available(p),
        is_featured=p.is_featured,
        image=to_image(p.images[0], url_for) if p.images else None,
    )


def to_detail(p: Product, url_for: UrlFor) -> ProductDetail:
    return ProductDetail(
        **to_summary(p, url_for).model_dump(),
        description=p.description,
        images=[to_image(i, url_for) for i in p.images],
    )


def to_admin(p: Product, url_for: UrlFor) -> AdminProduct:
    return AdminProduct(
        **to_detail(p, url_for).model_dump(),
        category_id=p.category_id,
        stock_quantity=p.stock_quantity,
        max_active_units=p.max_active_units,
        is_visible=p.is_visible,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


# ---- queries -------------------------------------------------------------------------------


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


_SORTS: dict[str, tuple[Any, ...]] = {
    "newest": (Product.created_at.desc(),),
    "price_asc": (Product.price_paisa.asc(),),
    "price_desc": (Product.price_paisa.desc(),),
    "name": (func.lower(Product.name).asc(),),
}


async def list_products(
    session: AsyncSession,
    *,
    visible_only: bool,
    search: str | None,
    category_id: uuid.UUID | None,
    availability: ProductAvailability | None,
    available_only: bool,
    featured: bool | None,
    min_price: int | None,
    max_price: int | None,
    sort: SortKey,
    page: int,
    page_size: int,
) -> tuple[list[Product], int]:
    conditions: list[ColumnElement[bool]] = []
    if visible_only:
        conditions.append(Product.is_visible.is_(True))
    if search and search.strip():
        like = f"%{_escape_like(search.strip())}%"
        conditions.append(
            or_(Product.name.ilike(like, escape="\\"), Product.description.ilike(like, escape="\\"))
        )
    if category_id:
        conditions.append(Product.category_id == category_id)
    if availability:
        conditions.append(Product.availability_type == availability)
    if available_only:
        conditions.append(availability_expr())
    if featured is not None:
        conditions.append(Product.is_featured.is_(featured))
    if min_price is not None:
        conditions.append(Product.price_paisa >= min_price)
    if max_price is not None:
        conditions.append(Product.price_paisa <= max_price)

    total = await session.scalar(select(func.count()).select_from(Product).where(*conditions))
    stmt: Select[tuple[Product]] = (
        select(Product)
        .where(*conditions)
        .options(
            selectinload(Product.category),
            selectinload(Product.images),
            with_expression(Product.active_units, active_units_expr()),
        )
        .order_by(*_SORTS[sort], Product.product_id)  # product_id: stable pagination
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await session.scalars(stmt)).all()
    return list(rows), total or 0


async def get_product(
    session: AsyncSession, product_id: uuid.UUID, *, visible_only: bool
) -> Product:
    stmt = (
        select(Product)
        .where(Product.product_id == product_id)
        .options(
            selectinload(Product.category),
            selectinload(Product.images),
            with_expression(Product.active_units, active_units_expr()),
        )
    )
    if visible_only:
        stmt = stmt.where(Product.is_visible.is_(True))
    product = (await session.scalars(stmt)).one_or_none()
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    return product


async def list_categories(session: AsyncSession) -> list[Category]:
    return list((await session.scalars(select(Category).order_by(Category.name))).all())


def paginate[T](items: list[T], total: int, page: int, page_size: int) -> Page[T]:
    return Page[T](items=items, total=total, page=page, page_size=page_size)


# ---- admin: categories ---------------------------------------------------------------------


async def create_category(session: AsyncSession, data: CategoryWrite) -> Category:
    category = Category(name=data.name)
    session.add(category)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Category name already exists") from None
    return category


async def _get_category(session: AsyncSession, category_id: uuid.UUID) -> Category:
    category = await session.get(Category, category_id)
    if category is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    return category


async def rename_category(
    session: AsyncSession, category_id: uuid.UUID, data: CategoryWrite
) -> Category:
    category = await _get_category(session, category_id)
    category.name = data.name
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Category name already exists") from None
    return category


async def delete_category(session: AsyncSession, category_id: uuid.UUID) -> None:
    """business-rules §4: a category cannot be deleted while products are assigned to it."""
    category = await _get_category(session, category_id)
    in_use = await session.scalar(
        select(func.count()).select_from(Product).where(Product.category_id == category_id)
    )
    if in_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Category has products; reassign them before deleting"
        )
    try:
        await session.delete(category)
        await session.commit()
    except IntegrityError:  # a product was assigned concurrently: the FK RESTRICT caught it
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Category has products; reassign them before deleting"
        ) from None


# ---- admin: products -----------------------------------------------------------------------


async def _require_category(session: AsyncSession, category_id: uuid.UUID) -> None:
    if await session.get(Category, category_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown category")


async def create_product(session: AsyncSession, data: ProductCreate) -> Product:
    await _require_category(session, data.category_id)
    product = Product(**data.model_dump())
    session.add(product)
    await session.commit()
    return await get_product(session, product.product_id, visible_only=False)


_NOT_NULLABLE = {
    "category_id",
    "name",
    "price_paisa",
    "availability_type",
    "stock_quantity",
    "max_active_units",
    "is_visible",
    "is_featured",
}


async def update_product(
    session: AsyncSession, product_id: uuid.UUID, data: ProductUpdate
) -> Product:
    product = await get_product(session, product_id, visible_only=False)
    changes = data.model_dump(exclude_unset=True)
    for field in changes.keys() & _NOT_NULLABLE:
        if changes[field] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{field} cannot be null")
    if "category_id" in changes:
        await _require_category(session, changes["category_id"])
    for field, value in changes.items():
        setattr(product, field, value)
    await session.commit()
    session.expire_all()
    return await get_product(session, product_id, visible_only=False)


async def delete_product(session: AsyncSession, product_id: uuid.UUID) -> list[str]:
    """Delete the product (image rows cascade). Returns Storage paths for the caller to remove.

    Historical order items keep their own snapshots (business-rules §3), so nothing else is
    touched here.
    """
    product = await get_product(session, product_id, visible_only=False)
    paths = [i.storage_path for i in product.images]
    await session.delete(product)
    await session.commit()
    return paths


# ---- admin: images -------------------------------------------------------------------------


def new_storage_path(product_id: uuid.UUID, extension: str) -> str:
    # The path is generated server-side; the client's filename is never used.
    return f"products/{product_id}/{uuid.uuid4().hex}.{extension}"


async def add_image(
    session: AsyncSession, product_id: uuid.UUID, data: ImageCreate
) -> ProductImage:
    await get_product(session, product_id, visible_only=False)
    if not storage_path_pattern(product_id).match(data.storage_path):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Invalid storage path")
    image = ProductImage(
        product_id=product_id,
        storage_path=data.storage_path,
        alt_text=data.alt_text,
        sort_order=data.sort_order,
    )
    session.add(image)
    await session.commit()
    return image


async def _get_image(
    session: AsyncSession, product_id: uuid.UUID, image_id: uuid.UUID
) -> ProductImage:
    image = await session.get(ProductImage, image_id)
    if image is None or image.product_id != product_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return image


async def update_image(
    session: AsyncSession, product_id: uuid.UUID, image_id: uuid.UUID, data: ImageUpdate
) -> ProductImage:
    image = await _get_image(session, product_id, image_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "sort_order" and value is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "sort_order cannot be null")
        setattr(image, field, value)
    await session.commit()
    return image


async def delete_image(session: AsyncSession, product_id: uuid.UUID, image_id: uuid.UUID) -> str:
    image = await _get_image(session, product_id, image_id)
    path = image.storage_path
    await session.delete(image)
    await session.commit()
    return path
