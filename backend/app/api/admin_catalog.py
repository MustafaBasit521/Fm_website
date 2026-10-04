import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_session
from app.core.storage import SupabaseStorage, get_storage, require_storage
from app.models.enums import ProductAvailability
from app.schemas.catalog import (
    ALLOWED_IMAGE_TYPES,
    AdminProduct,
    CategoryRead,
    CategoryWrite,
    ImageCreate,
    ImageUpdate,
    Page,
    ProductCreate,
    ProductImageRead,
    ProductUpdate,
    SortKey,
    UploadUrlRequest,
    UploadUrlResponse,
)
from app.services import catalog as service

# Every route here requires the admin role (enforced server-side, CLAUDE.md §6).
router = APIRouter(prefix="/admin", tags=["admin-catalog"], dependencies=[Depends(require_admin)])

Session = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[SupabaseStorage, Depends(get_storage)]
StorageRW = Annotated[SupabaseStorage, Depends(require_storage)]


# ---- categories ----------------------------------------------------------------------------


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(data: CategoryWrite, session: Session):
    return await service.create_category(session, data)


@router.patch("/categories/{category_id}", response_model=CategoryRead)
async def rename_category(category_id: uuid.UUID, data: CategoryWrite, session: Session):
    return await service.rename_category(session, category_id, data)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: uuid.UUID, session: Session):
    await service.delete_category(session, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- products ------------------------------------------------------------------------------


@router.get("/products", response_model=Page[AdminProduct])
async def list_products(
    session: Session,
    storage: Storage,
    search: Annotated[str | None, Query(max_length=100)] = None,
    category_id: uuid.UUID | None = None,
    availability: ProductAvailability | None = None,
    available_only: bool = False,
    featured: bool | None = None,
    sort: SortKey = "newest",
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    """All products including hidden ones."""
    rows, total = await service.list_products(
        session,
        visible_only=False,
        search=search,
        category_id=category_id,
        availability=availability,
        available_only=available_only,
        featured=featured,
        min_price=None,
        max_price=None,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    items = [service.to_admin(p, storage.public_url) for p in rows]
    return service.paginate(items, total, page, page_size)


@router.get("/products/{product_id}", response_model=AdminProduct)
async def get_product(product_id: uuid.UUID, session: Session, storage: Storage):
    return service.to_admin(
        await service.get_product(session, product_id, visible_only=False), storage.public_url
    )


@router.post("/products", response_model=AdminProduct, status_code=status.HTTP_201_CREATED)
async def create_product(data: ProductCreate, session: Session, storage: Storage):
    return service.to_admin(await service.create_product(session, data), storage.public_url)


@router.patch("/products/{product_id}", response_model=AdminProduct)
async def update_product(
    product_id: uuid.UUID, data: ProductUpdate, session: Session, storage: Storage
):
    return service.to_admin(
        await service.update_product(session, product_id, data), storage.public_url
    )


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: uuid.UUID, session: Session, storage: Storage):
    paths = await service.delete_product(session, product_id)
    # DB rows are gone; remove the files too (database.md §8). Failures are logged, not raised.
    await storage.delete(paths)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- images (CLAUDE.md §10: signed upload URL, browser uploads directly) -------------------


@router.post("/products/{product_id}/images/upload-url", response_model=UploadUrlResponse)
async def image_upload_url(
    product_id: uuid.UUID, data: UploadUrlRequest, session: Session, storage: StorageRW
):
    await service.get_product(session, product_id, visible_only=False)
    path = service.new_storage_path(product_id, ALLOWED_IMAGE_TYPES[data.content_type])
    signed = await storage.create_signed_upload(path)
    return UploadUrlResponse(
        storage_path=signed.path,
        upload_url=signed.upload_url,
        token=signed.token,
        bucket=storage.bucket,
    )


@router.post(
    "/products/{product_id}/images",
    response_model=ProductImageRead,
    status_code=status.HTTP_201_CREATED,
)
async def register_image(
    product_id: uuid.UUID, data: ImageCreate, session: Session, storage: Storage
):
    image = await service.add_image(session, product_id, data)
    return service.to_image(image, storage.public_url)


@router.patch("/products/{product_id}/images/{image_id}", response_model=ProductImageRead)
async def update_image(
    product_id: uuid.UUID,
    image_id: uuid.UUID,
    data: ImageUpdate,
    session: Session,
    storage: Storage,
):
    image = await service.update_image(session, product_id, image_id, data)
    return service.to_image(image, storage.public_url)


@router.delete("/products/{product_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_image(
    product_id: uuid.UUID, image_id: uuid.UUID, session: Session, storage: Storage
):
    path = await service.delete_image(session, product_id, image_id)
    await storage.delete([path])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
