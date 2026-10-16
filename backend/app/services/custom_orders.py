"""Custom orders (business-rules §29, database.md §15): requests for made-to-measure work,
separate from the normal order lifecycle. Guests may submit; communication happens on
WhatsApp/email, and the admin moves the request through its statuses."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser
from app.core.storage import StorageNotConfiguredError, SupabaseStorage
from app.models.engagement import CustomOrder, CustomOrderMessage
from app.models.enums import CustomOrderMessageSender
from app.models.enums import CustomOrderStatus as S
from app.schemas.engagement import (
    AdminCustomOrderRead,
    CustomOrderCreate,
    CustomOrderMessageRead,
    CustomOrderRead,
)
from app.services import events
from app.services.customers import get_or_create_customer

# What the admin may do next. COMPLETED, DECLINED and CANCELLED are final.
ADMIN_TRANSITIONS: dict[S, set[S]] = {
    S.NEW: {S.IN_DISCUSSION, S.DECLINED, S.CANCELLED},
    S.IN_DISCUSSION: {S.ACCEPTED, S.DECLINED, S.CANCELLED},
    S.ACCEPTED: {S.IN_PROGRESS, S.CANCELLED},
    S.IN_PROGRESS: {S.COMPLETED, S.CANCELLED},
}
# The discussion is open until the request is finished one way or another.
DISCUSSION_OPEN = (S.NEW, S.IN_DISCUSSION, S.ACCEPTED, S.IN_PROGRESS)
MAX_THREAD = 500  # messages returned for one request
# A customer may withdraw only while nothing has been agreed yet.
CUSTOMER_CANCELLABLE = (S.NEW, S.IN_DISCUSSION)


def _problem(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message})


def to_read(co: CustomOrder) -> CustomOrderRead:
    return CustomOrderRead(
        custom_order_id=co.custom_order_id,
        name=co.name,
        whatsapp_number=co.whatsapp_number,
        description=co.description,
        budget_paisa=co.budget_paisa,
        agreed_price_paisa=co.agreed_price_paisa,
        required_date=co.required_date,
        status=co.status,
        has_reference_image=co.reference_image_path is not None,
        created_at=co.created_at,
        updated_at=co.updated_at,
    )


async def to_admin_read(co: CustomOrder, storage: SupabaseStorage) -> AdminCustomOrderRead:
    url = None
    if co.reference_image_path:
        try:  # the bucket is private: the admin sees the image through a temporary signed link
            url = await storage.create_signed_download(
                co.reference_image_path, storage.custom_orders_bucket
            )
        except StorageNotConfiguredError:
            url = None
    return AdminCustomOrderRead(
        **to_read(co).model_dump(), customer_id=co.customer_id, reference_image_url=url
    )


async def submit(
    session: AsyncSession, user: AuthUser | None, data: CustomOrderCreate
) -> CustomOrder:
    if user is not None:
        await get_or_create_customer(session, user)
    co = CustomOrder(customer_id=user.id if user else None, status=S.NEW, **data.model_dump())
    session.add(co)
    await session.flush()
    await events.custom_order_received(session, co)
    await session.commit()
    await session.refresh(co)
    return co


async def _load(session: AsyncSession, custom_order_id: uuid.UUID, *, lock: bool) -> CustomOrder:
    stmt = (
        select(CustomOrder)
        .where(CustomOrder.custom_order_id == custom_order_id)
        .execution_options(populate_existing=True)
    )
    if lock:
        stmt = stmt.with_for_update()
    co = (await session.scalars(stmt)).one_or_none()
    if co is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Custom order not found")
    return co


# ---- the signed-in customer ----------------------------------------------------------------


async def list_mine(
    session: AsyncSession, user: AuthUser, page: int, page_size: int
) -> tuple[list[CustomOrder], int]:
    where = CustomOrder.customer_id == user.id
    total = await session.scalar(select(func.count()).select_from(CustomOrder).where(where))
    stmt = (
        select(CustomOrder)
        .where(where)
        .order_by(CustomOrder.created_at.desc(), CustomOrder.custom_order_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list((await session.scalars(stmt)).all()), total or 0


async def get_mine(
    session: AsyncSession, user: AuthUser, custom_order_id: uuid.UUID
) -> CustomOrder:
    co = await _load(session, custom_order_id, lock=False)
    if co.customer_id != user.id:  # someone else's (or a guest's) request looks like "not found"
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Custom order not found")
    return co


async def cancel_mine(
    session: AsyncSession, user: AuthUser, custom_order_id: uuid.UUID
) -> CustomOrder:
    co = await _load(session, custom_order_id, lock=True)
    if co.customer_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Custom order not found")
    if co.status not in CUSTOMER_CANCELLABLE:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "CANNOT_CANCEL",
            "This request can no longer be cancelled here. Please contact the shop.",
        )
    co.status = S.CANCELLED
    await events.custom_order_status_changed(session, co)
    await session.commit()
    return await _load(session, custom_order_id, lock=False)


# ---- admin ---------------------------------------------------------------------------------


async def list_admin(
    session: AsyncSession,
    *,
    custom_status: S | None,
    search: str | None,
    page: int,
    page_size: int,
) -> tuple[list[CustomOrder], int]:
    where: list[ColumnElement[bool]] = []
    if custom_status:
        where.append(CustomOrder.status == custom_status)
    if search and search.strip():
        like = (
            "%" + search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        )
        where.append(
            or_(
                CustomOrder.name.ilike(like, escape="\\"),
                CustomOrder.whatsapp_number.ilike(like, escape="\\"),
                CustomOrder.description.ilike(like, escape="\\"),
            )
        )
    total = await session.scalar(select(func.count()).select_from(CustomOrder).where(*where))
    stmt = (
        select(CustomOrder)
        .where(*where)
        .order_by(CustomOrder.created_at.desc(), CustomOrder.custom_order_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list((await session.scalars(stmt)).all()), total or 0


async def get_admin(session: AsyncSession, custom_order_id: uuid.UUID) -> CustomOrder:
    return await _load(session, custom_order_id, lock=False)


async def change_status(
    session: AsyncSession, custom_order_id: uuid.UUID, target: S
) -> CustomOrder:
    if target == S.ACCEPTED:  # acceptance carries the agreed price: it has its own action
        raise _problem(
            status.HTTP_409_CONFLICT,
            "USE_ACCEPT",
            "Accept a custom order together with the price agreed in the discussion",
        )
    co = await _load(session, custom_order_id, lock=True)
    if target not in ADMIN_TRANSITIONS.get(co.status, set()):
        raise _problem(
            status.HTTP_409_CONFLICT,
            "INVALID_TRANSITION",
            f"A custom order cannot move from {co.status} to {target}",
        )
    co.status = target
    await events.custom_order_status_changed(session, co)
    await session.commit()
    return await _load(session, custom_order_id, lock=False)


async def accept_at_price(
    session: AsyncSession, custom_order_id: uuid.UUID, agreed_price_paisa: int
) -> CustomOrder:
    """The admin accepts the request at the final price agreed in the discussion: the price is
    saved together with the move to ACCEPTED, so an accepted request always carries its price."""
    co = await _load(session, custom_order_id, lock=True)
    if S.ACCEPTED not in ADMIN_TRANSITIONS.get(co.status, set()):
        raise _problem(
            status.HTTP_409_CONFLICT,
            "INVALID_TRANSITION",
            "Only a request that is being discussed can be accepted",
        )
    co.agreed_price_paisa = agreed_price_paisa
    co.status = S.ACCEPTED
    await events.custom_order_accepted(session, co)
    await session.commit()
    return await _load(session, custom_order_id, lock=False)


# ---- the discussion (registered customers and the admin) -------------------------------------


async def list_messages(
    session: AsyncSession, custom_order_id: uuid.UUID
) -> list[CustomOrderMessageRead]:
    rows = await session.scalars(
        select(CustomOrderMessage)
        .where(CustomOrderMessage.custom_order_id == custom_order_id)
        .order_by(CustomOrderMessage.created_at, CustomOrderMessage.message_id)
        .limit(MAX_THREAD)
    )
    return [CustomOrderMessageRead.model_validate(m) for m in rows.all()]


async def post_message(
    session: AsyncSession,
    custom_order_id: uuid.UUID,
    sender: CustomOrderMessageSender,
    body: str,
) -> CustomOrderMessageRead:
    co = await _load(session, custom_order_id, lock=True)  # a finished request cannot get new text
    if co.customer_id is None:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "NO_DISCUSSION",
            "This request came from a guest, so there is no discussion here. Use WhatsApp.",
        )
    if co.status not in DISCUSSION_OPEN:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "DISCUSSION_CLOSED",
            "This request is finished, so the discussion is closed.",
        )
    message = CustomOrderMessage(custom_order_id=custom_order_id, sender=sender, body=body)
    session.add(message)
    await session.flush()
    await events.custom_order_message(session, co, sender, body)
    await session.commit()
    return CustomOrderMessageRead.model_validate(message)
