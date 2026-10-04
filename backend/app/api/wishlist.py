import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.db import get_session
from app.core.storage import SupabaseStorage, get_storage
from app.schemas.catalog import Page, ProductSummary
from app.schemas.wishlist import WishlistAdd
from app.services import catalog as catalog_service
from app.services import wishlist as service

# Wishlist is for registered customers only (business-rules §25): every route needs a token,
# and the owner is always the token's user, never a client-supplied id.
router = APIRouter(prefix="/customers/me/wishlist", tags=["wishlist"])

CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
Session = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[SupabaseStorage, Depends(get_storage)]


@router.get("", response_model=Page[ProductSummary])
async def list_wishlist(
    user: CurrentUser,
    session: Session,
    storage: Storage,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 12,
):
    rows, total = await service.list_wishlist(session, user, page, page_size)
    items = [catalog_service.to_summary(p, storage.public_url) for p in rows]
    return catalog_service.paginate(items, total, page, page_size)


@router.get("/ids", response_model=list[uuid.UUID])
async def wishlist_ids(user: CurrentUser, session: Session):
    """Product ids on the wishlist, so product pages can show a filled/empty heart."""
    return await service.wishlist_product_ids(session, user)


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_to_wishlist(data: WishlistAdd, user: CurrentUser, session: Session):
    await service.add_to_wishlist(session, user, data.product_id)
    return {"product_id": str(data.product_id)}


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_from_wishlist(product_id: uuid.UUID, user: CurrentUser, session: Session):
    await service.remove_from_wishlist(session, user, product_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
