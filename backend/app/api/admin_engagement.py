"""Admin routes for reviews, gallery, custom orders and contact messages (admin-only)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_session
from app.core.storage import SupabaseStorage, get_storage, require_storage
from app.models.enums import CustomOrderStatus, GalleryImageType, MessageStatus
from app.schemas.catalog import Page
from app.schemas.engagement import (
    IMAGE_TYPES,
    AdminCustomOrderRead,
    AdminGalleryImage,
    AdminReviewRead,
    CustomOrderStatusChange,
    GalleryCreate,
    GalleryUpdate,
    MessageRead,
    MessageStatusChange,
    UploadRequest,
    UploadTarget,
)
from app.services import catalog as catalog_service
from app.services import contact as contact_service
from app.services import custom_orders as custom_service
from app.services import gallery as gallery_service
from app.services import reviews as review_service

_admin = {"dependencies": [Depends(require_admin)]}
Session = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[SupabaseStorage, Depends(get_storage)]
StorageRW = Annotated[SupabaseStorage, Depends(require_storage)]

# ---- reviews -------------------------------------------------------------------------------

reviews = APIRouter(prefix="/admin/reviews", tags=["admin-reviews"], **_admin)


@reviews.get("", response_model=Page[AdminReviewRead])
async def list_reviews(
    session: Session,
    product_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = await review_service.list_admin_reviews(session, product_id, page, page_size)
    return catalog_service.paginate(items, total, page, page_size)


@reviews.delete("/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_review(review_id: uuid.UUID, session: Session):
    await review_service.admin_delete_review(session, review_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- gallery -------------------------------------------------------------------------------

gallery = APIRouter(prefix="/admin/gallery", tags=["admin-gallery"], **_admin)


@gallery.post("/upload-url", response_model=UploadTarget)
async def gallery_upload_url(data: UploadRequest, storage: StorageRW):
    path = gallery_service.new_gallery_path(IMAGE_TYPES[data.content_type])
    signed = await storage.create_signed_upload(path, storage.gallery_bucket)
    return UploadTarget(
        storage_path=signed.path,
        upload_url=signed.upload_url,
        token=signed.token,
        bucket=storage.gallery_bucket,
    )


@gallery.post("", response_model=AdminGalleryImage, status_code=status.HTTP_201_CREATED)
async def create_gallery_image(data: GalleryCreate, session: Session, storage: Storage):
    image = await gallery_service.create_image(session, data)
    return gallery_service.to_admin(image, lambda p: storage.public_url(p, storage.gallery_bucket))


@gallery.get("", response_model=Page[AdminGalleryImage])
async def list_gallery(
    session: Session,
    storage: Storage,
    type: GalleryImageType | None = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
):
    rows, total = await gallery_service.list_images(
        session, visible_only=False, image_type=type, page=page, page_size=page_size
    )

    def url_for(p: str) -> str:
        return storage.public_url(p, storage.gallery_bucket)

    return catalog_service.paginate(
        [gallery_service.to_admin(i, url_for) for i in rows], total, page, page_size
    )


@gallery.patch("/{image_id}", response_model=AdminGalleryImage)
async def update_gallery_image(
    image_id: uuid.UUID, data: GalleryUpdate, session: Session, storage: Storage
):
    image = await gallery_service.update_image(session, image_id, data)
    return gallery_service.to_admin(image, lambda p: storage.public_url(p, storage.gallery_bucket))


@gallery.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_gallery_image(image_id: uuid.UUID, session: Session, storage: Storage):
    path = await gallery_service.delete_image(session, image_id)
    await storage.delete([path], storage.gallery_bucket)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- custom orders -------------------------------------------------------------------------

custom_orders = APIRouter(prefix="/admin/custom-orders", tags=["admin-custom-orders"], **_admin)


@custom_orders.get("", response_model=Page[AdminCustomOrderRead])
async def list_custom_orders(
    session: Session,
    storage: Storage,
    status: CustomOrderStatus | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    rows, total = await custom_service.list_admin(
        session, custom_status=status, search=search, page=page, page_size=page_size
    )
    items = [await custom_service.to_admin_read(c, storage) for c in rows]
    return catalog_service.paginate(items, total, page, page_size)


@custom_orders.get("/{custom_order_id}", response_model=AdminCustomOrderRead)
async def get_custom_order(custom_order_id: uuid.UUID, session: Session, storage: Storage):
    co = await custom_service.get_admin(session, custom_order_id)
    return await custom_service.to_admin_read(co, storage)


@custom_orders.post("/{custom_order_id}/status", response_model=AdminCustomOrderRead)
async def change_custom_order_status(
    custom_order_id: uuid.UUID, data: CustomOrderStatusChange, session: Session, storage: Storage
):
    co = await custom_service.change_status(session, custom_order_id, data.status)
    return await custom_service.to_admin_read(co, storage)


# ---- contact messages ----------------------------------------------------------------------

messages = APIRouter(prefix="/admin/messages", tags=["admin-messages"], **_admin)


@messages.get("", response_model=Page[MessageRead])
async def list_messages(
    session: Session,
    status: MessageStatus | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    rows, total = await contact_service.list_messages(
        session, message_status=status, search=search, page=page, page_size=page_size
    )
    items = [MessageRead.model_validate(m) for m in rows]
    return catalog_service.paginate(items, total, page, page_size)


@messages.get("/{message_id}", response_model=MessageRead)
async def get_message(message_id: uuid.UUID, session: Session):
    return await contact_service.get_message(session, message_id)


@messages.post("/{message_id}/status", response_model=MessageRead)
async def set_message_status(message_id: uuid.UUID, data: MessageStatusChange, session: Session):
    return await contact_service.set_status(session, message_id, data.status)
