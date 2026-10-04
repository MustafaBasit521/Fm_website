import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.storage import SupabaseStorage, get_storage
from app.models.enums import ProductAvailability
from app.schemas.catalog import CategoryRead, Page, ProductDetail, ProductSummary, SortKey
from app.services import catalog as service

router = APIRouter(tags=["catalog"])

Session = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[SupabaseStorage, Depends(get_storage)]


@router.get("/categories", response_model=list[CategoryRead])
async def categories(session: Session):
    return await service.list_categories(session)


@router.get("/products", response_model=Page[ProductSummary])
async def products(
    session: Session,
    storage: Storage,
    search: Annotated[str | None, Query(max_length=100)] = None,
    category_id: uuid.UUID | None = None,
    availability: ProductAvailability | None = None,
    available_only: bool = False,
    featured: bool | None = None,
    min_price: Annotated[int | None, Query(ge=0)] = None,
    max_price: Annotated[int | None, Query(ge=0)] = None,
    sort: SortKey = "newest",
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 12,
):
    """Public storefront listing. Only visible products are ever returned."""
    rows, total = await service.list_products(
        session,
        visible_only=True,
        search=search,
        category_id=category_id,
        availability=availability,
        available_only=available_only,
        featured=featured,
        min_price=min_price,
        max_price=max_price,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    items = [service.to_summary(p, storage.public_url) for p in rows]
    return service.paginate(items, total, page, page_size)


@router.get("/products/{product_id}", response_model=ProductDetail)
async def product_detail(product_id: uuid.UUID, session: Session, storage: Storage):
    product = await service.get_product(session, product_id, visible_only=True)
    return service.to_detail(product, storage.public_url)
