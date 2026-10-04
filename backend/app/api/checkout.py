from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_optional_user
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.storage import SupabaseStorage, get_storage
from app.schemas.checkout import OrderCreate, OrderRead, Quote, QuoteRequest
from app.services import checkout as service

router = APIRouter(tags=["checkout"])

Session = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[SupabaseStorage, Depends(get_storage)]
AppSettings = Annotated[Settings, Depends(get_settings)]
OptionalUser = Annotated[AuthUser | None, Depends(get_optional_user)]


@router.post("/checkout/quote", response_model=Quote)
async def quote(data: QuoteRequest, session: Session, storage: Storage, settings: AppSettings):
    """Authoritative price/availability for a browser cart. Public: guests can check out."""
    return await service.quote(session, data.items, settings, storage.public_url)


@router.post("/orders", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    data: OrderCreate, user: OptionalUser, session: Session, settings: AppSettings
):
    """Create an order (guest or registered). Totals, stock and delivery eligibility are all
    recomputed here; nothing price-related is trusted from the client."""
    return await service.create_order(session, user, data, settings)
