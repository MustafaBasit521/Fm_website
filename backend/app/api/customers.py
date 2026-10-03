from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.db import get_session
from app.schemas.customer import CustomerRead, CustomerUpdate
from app.services import customers as service

router = APIRouter(prefix="/customers", tags=["customers"])

CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
Session = Annotated[AsyncSession, Depends(get_session)]


# Customers can only ever reach their own record: there is no {id} in these paths, the
# identity comes solely from the verified token.
@router.get("/me", response_model=CustomerRead)
async def read_me(user: CurrentUser, session: Session):
    return await service.get_or_create_customer(session, user)


@router.patch("/me", response_model=CustomerRead)
async def update_me(data: CustomerUpdate, user: CurrentUser, session: Session):
    return await service.update_customer(session, user, data)
