import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.db import get_session
from app.schemas.address import AddressCreate, AddressRead, AddressUpdate
from app.services import addresses as service

router = APIRouter(prefix="/customers/me/addresses", tags=["addresses"])

CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=list[AddressRead])
async def list_addresses(user: CurrentUser, session: Session):
    return await service.list_addresses(session, user)


@router.post("", response_model=AddressRead, status_code=status.HTTP_201_CREATED)
async def create_address(data: AddressCreate, user: CurrentUser, session: Session):
    return await service.create_address(session, user, data)


@router.patch("/{address_id}", response_model=AddressRead)
async def update_address(
    address_id: uuid.UUID, data: AddressUpdate, user: CurrentUser, session: Session
):
    return await service.update_address(session, user, address_id, data)


@router.delete("/{address_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_address(address_id: uuid.UUID, user: CurrentUser, session: Session):
    await service.delete_address(session, user, address_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
