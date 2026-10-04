import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser
from app.models.engagement import Notification
from app.models.enums import NotificationStatus
from app.services.customers import get_or_create_customer


async def list_notifications(
    session: AsyncSession, user: AuthUser, *, unread_only: bool, page: int, page_size: int
) -> tuple[list[Notification], int]:
    await get_or_create_customer(session, user)
    where = [Notification.customer_id == user.id]
    if unread_only:
        where.append(Notification.status == NotificationStatus.UNREAD)
    total = await session.scalar(select(func.count()).select_from(Notification).where(*where))
    stmt = (
        select(Notification)
        .where(*where)
        .order_by(Notification.created_at.desc(), Notification.notification_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list((await session.scalars(stmt)).all()), total or 0


async def unread_count(session: AsyncSession, user: AuthUser) -> int:
    await get_or_create_customer(session, user)
    return (
        await session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.customer_id == user.id,
                Notification.status == NotificationStatus.UNREAD,
            )
        )
        or 0
    )


async def mark_read(
    session: AsyncSession, user: AuthUser, notification_id: uuid.UUID
) -> Notification:
    # Ownership is part of the query: someone else's notification is "not found".
    stmt = select(Notification).where(
        Notification.notification_id == notification_id, Notification.customer_id == user.id
    )
    notification = (await session.scalars(stmt)).one_or_none()
    if notification is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    if notification.status != NotificationStatus.READ:
        notification.status = NotificationStatus.READ
        await session.commit()
    return notification


async def mark_all_read(session: AsyncSession, user: AuthUser) -> int:
    result = await session.execute(
        update(Notification)
        .where(
            Notification.customer_id == user.id,
            Notification.status == NotificationStatus.UNREAD,
        )
        .values(status=NotificationStatus.READ)
    )
    await session.commit()
    return result.rowcount or 0
