import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser
from app.models.customer_data import Address
from app.schemas.address import (
    MAX_ADDRESSES_PER_CUSTOMER,
    AddressCreate,
    AddressUpdate,
)
from app.services.customers import get_or_create_customer

_REQUIRED = {"house_no", "city", "postal_code", "country"}


async def list_addresses(session: AsyncSession, user: AuthUser) -> list[Address]:
    await get_or_create_customer(session, user)
    stmt = (
        select(Address)
        .where(Address.customer_id == user.id)
        .order_by(Address.created_at, Address.address_id)
    )
    return list((await session.scalars(stmt)).all())


async def create_address(session: AsyncSession, user: AuthUser, data: AddressCreate) -> Address:
    await get_or_create_customer(session, user)
    count = await session.scalar(
        select(func.count()).select_from(Address).where(Address.customer_id == user.id)
    )
    if (count or 0) >= MAX_ADDRESSES_PER_CUSTOMER:
        raise HTTPException(status.HTTP_409_CONFLICT, "Too many saved addresses")
    address = Address(customer_id=user.id, **data.model_dump())
    session.add(address)
    await session.commit()
    return address


async def _own_address(session: AsyncSession, user: AuthUser, address_id: uuid.UUID) -> Address:
    # Ownership is part of the query: another customer's address is simply "not found".
    stmt = select(Address).where(Address.address_id == address_id, Address.customer_id == user.id)
    address = (await session.scalars(stmt)).one_or_none()
    if address is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Address not found")
    return address


async def update_address(
    session: AsyncSession, user: AuthUser, address_id: uuid.UUID, data: AddressUpdate
) -> Address:
    address = await _own_address(session, user, address_id)
    changes = data.model_dump(exclude_unset=True)
    for field in changes.keys() & _REQUIRED:
        if changes[field] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{field} cannot be null")
    for field, value in changes.items():
        setattr(address, field, value)
    await session.commit()
    return address


async def delete_address(session: AsyncSession, user: AuthUser, address_id: uuid.UUID) -> None:
    address = await _own_address(session, user, address_id)
    await session.delete(address)
    await session.commit()
