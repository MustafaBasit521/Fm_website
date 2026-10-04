"""Customer-facing and public engagement routes: notifications, reviews, gallery, custom orders,
contact. Abuse-prone public writes are rate limited (business-rules §29, CLAUDE.md §9)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user, get_optional_user
from app.core.db import get_session
from app.core.rate_limit import rate_limit
from app.core.storage import SupabaseStorage, get_storage, require_storage
from app.models.enums import GalleryImageType
from app.schemas.catalog import Page
from app.schemas.engagement import (
    IMAGE_TYPES,
    ContactCreate,
    CustomOrderCreate,
    CustomOrderRead,
    GalleryImageRead,
    MyReviewState,
    NotificationRead,
    ReviewCreate,
    ReviewList,
    ReviewRead,
    ReviewUpdate,
    UnreadCount,
    UploadRequest,
    UploadTarget,
)
from app.services import catalog as catalog_service
from app.services import contact as contact_service
from app.services import custom_orders as custom_service
from app.services import gallery as gallery_service
from app.services import notifications as notification_service
from app.services import reviews as review_service

Session = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
OptionalUser = Annotated[AuthUser | None, Depends(get_optional_user)]
Storage = Annotated[SupabaseStorage, Depends(get_storage)]
StorageRW = Annotated[SupabaseStorage, Depends(require_storage)]

# ---- notifications (registered customers) --------------------------------------------------

notifications = APIRouter(prefix="/customers/me/notifications", tags=["notifications"])


@notifications.get("", response_model=Page[NotificationRead])
async def list_notifications(
    user: CurrentUser,
    session: Session,
    unread_only: bool = False,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 20,
):
    rows, total = await notification_service.list_notifications(
        session, user, unread_only=unread_only, page=page, page_size=page_size
    )
    items = [NotificationRead.model_validate(n) for n in rows]
    return catalog_service.paginate(items, total, page, page_size)


@notifications.get("/unread-count", response_model=UnreadCount)
async def unread_count(user: CurrentUser, session: Session):
    return UnreadCount(unread=await notification_service.unread_count(session, user))


@notifications.post("/read-all")
async def read_all(user: CurrentUser, session: Session):
    return {"updated": await notification_service.mark_all_read(session, user)}


@notifications.post("/{notification_id}/read", response_model=NotificationRead)
async def read_one(notification_id: uuid.UUID, user: CurrentUser, session: Session):
    return await notification_service.mark_read(session, user, notification_id)


# ---- reviews -------------------------------------------------------------------------------

reviews = APIRouter(prefix="/products/{product_id}/reviews", tags=["reviews"])


@reviews.get("", response_model=ReviewList)
async def list_reviews(
    product_id: uuid.UUID,
    session: Session,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 10,
):
    return await review_service.list_reviews(session, product_id, page, page_size)


@reviews.get("/me", response_model=MyReviewState)
async def my_review_state(product_id: uuid.UUID, user: CurrentUser, session: Session):
    """Whether I may review this product (Delivered order) and my existing review, if any."""
    return await review_service.my_state(session, user, product_id)


@reviews.post("", response_model=ReviewRead, status_code=status.HTTP_201_CREATED)
async def create_review(
    product_id: uuid.UUID, data: ReviewCreate, user: CurrentUser, session: Session
):
    return await review_service.create_review(session, user, product_id, data)


@reviews.patch("/me", response_model=ReviewRead)
async def update_review(
    product_id: uuid.UUID, data: ReviewUpdate, user: CurrentUser, session: Session
):
    return await review_service.update_review(session, user, product_id, data)


@reviews.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_review(product_id: uuid.UUID, user: CurrentUser, session: Session):
    await review_service.delete_own_review(session, user, product_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- gallery (public) ----------------------------------------------------------------------

gallery = APIRouter(prefix="/gallery", tags=["gallery"])


@gallery.get("", response_model=Page[GalleryImageRead])
async def list_gallery(
    session: Session,
    storage: Storage,
    type: GalleryImageType | None = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 24,
):
    rows, total = await gallery_service.list_images(
        session, visible_only=True, image_type=type, page=page, page_size=page_size
    )

    def url_for(path: str) -> str:
        return storage.public_url(path, storage.gallery_bucket)

    items = [gallery_service.to_read(i, url_for) for i in rows]
    return catalog_service.paginate(items, total, page, page_size)


# ---- custom orders -------------------------------------------------------------------------

custom_orders = APIRouter(prefix="/custom-orders", tags=["custom-orders"])


@custom_orders.post(
    "/upload-url",
    response_model=UploadTarget,
    dependencies=[Depends(rate_limit("custom-order-upload", 10, 3600))],
)
async def custom_order_upload_url(data: UploadRequest, storage: StorageRW):
    """A signed upload URL for ONE reference image in the PRIVATE bucket. Public (guests can
    submit) but rate limited; the bucket itself enforces file type and size."""
    path = f"custom-orders/{uuid.uuid4().hex}.{IMAGE_TYPES[data.content_type]}"
    signed = await storage.create_signed_upload(path, storage.custom_orders_bucket)
    return UploadTarget(
        storage_path=signed.path,
        upload_url=signed.upload_url,
        token=signed.token,
        bucket=storage.custom_orders_bucket,
    )


@custom_orders.post(
    "",
    response_model=CustomOrderRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("custom-order", 5, 3600))],
)
async def submit_custom_order(data: CustomOrderCreate, user: OptionalUser, session: Session):
    return custom_service.to_read(await custom_service.submit(session, user, data))


@custom_orders.get("", response_model=Page[CustomOrderRead])
async def my_custom_orders(
    user: CurrentUser,
    session: Session,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 10,
):
    rows, total = await custom_service.list_mine(session, user, page, page_size)
    return catalog_service.paginate(
        [custom_service.to_read(c) for c in rows], total, page, page_size
    )


@custom_orders.get("/{custom_order_id}", response_model=CustomOrderRead)
async def my_custom_order(custom_order_id: uuid.UUID, user: CurrentUser, session: Session):
    return custom_service.to_read(await custom_service.get_mine(session, user, custom_order_id))


@custom_orders.post("/{custom_order_id}/cancel", response_model=CustomOrderRead)
async def cancel_my_custom_order(custom_order_id: uuid.UUID, user: CurrentUser, session: Session):
    return custom_service.to_read(await custom_service.cancel_mine(session, user, custom_order_id))


# ---- contact -------------------------------------------------------------------------------

contact = APIRouter(prefix="/contact", tags=["contact"])


@contact.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("contact", 5, 3600))],
)
async def send_message(data: ContactCreate, session: Session):
    await contact_service.submit(session, data)
    return {"received": True}
