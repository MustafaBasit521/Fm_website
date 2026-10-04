import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.engagement import Message
from app.models.enums import MessageStatus
from app.schemas.engagement import ContactCreate
from app.services import events


async def submit(session: AsyncSession, data: ContactCreate) -> Message:
    message = Message(
        name=data.name,
        email=data.email,
        phone=data.phone,
        whatsapp_number=data.whatsapp_number,
        message=data.message,
        status=MessageStatus.NEW,
    )
    session.add(message)
    await session.flush()
    await events.message_received(session, message)
    await session.commit()
    return message


async def list_messages(
    session: AsyncSession,
    *,
    message_status: MessageStatus | None,
    search: str | None,
    page: int,
    page_size: int,
) -> tuple[list[Message], int]:
    where: list[ColumnElement[bool]] = []
    if message_status:
        where.append(Message.status == message_status)
    if search and search.strip():
        like = (
            "%" + search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        )
        where.append(
            or_(
                Message.name.ilike(like, escape="\\"),
                Message.email.ilike(like, escape="\\"),
                Message.message.ilike(like, escape="\\"),
            )
        )
    total = await session.scalar(select(func.count()).select_from(Message).where(*where))
    stmt = (
        select(Message)
        .where(*where)
        .order_by(Message.created_at.desc(), Message.message_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list((await session.scalars(stmt)).all()), total or 0


async def _get(session: AsyncSession, message_id: uuid.UUID) -> Message:
    message = await session.get(Message, message_id)
    if message is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    return message


async def get_message(session: AsyncSession, message_id: uuid.UUID) -> Message:
    return await _get(session, message_id)


async def set_status(
    session: AsyncSession, message_id: uuid.UUID, new_status: MessageStatus
) -> Message:
    message = await _get(session, message_id)
    message.status = new_status
    await session.commit()
    return message
