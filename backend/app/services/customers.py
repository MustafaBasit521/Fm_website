from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser
from app.models.customer import Customer
from app.schemas.customer import CustomerUpdate


async def get_or_create_customer(session: AsyncSession, user: AuthUser) -> Customer:
    """Return the application customer row for an authenticated Supabase user.

    The row is created lazily on first use (database.md §4; business-rules §7: new accounts
    are subscribed to updates, which is the column default). The insert is
    ON CONFLICT DO NOTHING so two concurrent first requests cannot collide.
    """
    if not user.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Account has no email address")
    name = (user.name or "").strip()[:100] or user.email.split("@")[0]
    try:
        await session.execute(
            insert(Customer)
            .values(customer_id=user.id, name=name, email=user.email)
            .on_conflict_do_nothing(index_elements=[Customer.customer_id])
        )
        await session.commit()
    except IntegrityError:
        # customer_id is new but the email already belongs to a different customer row.
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered") from None
    result = await session.execute(select(Customer).where(Customer.customer_id == user.id))
    return result.scalar_one()


async def update_customer(session: AsyncSession, user: AuthUser, data: CustomerUpdate) -> Customer:
    customer = await get_or_create_customer(session, user)
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "name cannot be null")
    if "subscribed_to_updates" in changes and changes["subscribed_to_updates"] is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "subscribed_to_updates cannot be null"
        )
    for field, value in changes.items():
        setattr(customer, field, value)
    await session.commit()
    await session.refresh(customer)
    return customer
