"""Custom orders (business-rules §29, database.md §15): requests for made-to-measure work,
separate from the normal order lifecycle. Guests may submit; communication happens on
WhatsApp/email, and the admin moves the request through its statuses."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser
from app.core.money import format_price
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
        customer_offer_paisa=co.customer_offer_paisa,
        proposed_price_paisa=co.proposed_price_paisa,
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
            "A custom order is accepted when the customer confirms the proposed price",
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


async def propose_price(
    session: AsyncSession, custom_order_id: uuid.UUID, price_paisa: int
) -> CustomOrder:
    """The admin proposes a price during the discussion. It can be changed until the customer
    confirms it. Nothing is agreed yet: the request stays IN_DISCUSSION."""
    co = await _load(session, custom_order_id, lock=True)
    if co.customer_id is None:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "NO_DISCUSSION",
            "This request came from a guest: agree the price on WhatsApp, then record it.",
        )
    if co.status != S.IN_DISCUSSION:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "INVALID_TRANSITION",
            "A price can be proposed only while the request is being discussed",
        )
    co.proposed_price_paisa = price_paisa
    co.customer_offer_paisa = None  # the shop has answered the customer's offer
    _note(session, co, CustomOrderMessageSender.ADMIN, f"We propose {format_price(price_paisa)}.")
    await events.custom_order_price_proposed(session, co)
    await session.commit()
    return await _load(session, custom_order_id, lock=False)


async def confirm_price(
    session: AsyncSession, user: AuthUser, custom_order_id: uuid.UUID, price_paisa: int
) -> CustomOrder:
    """The customer confirms the proposed price: it becomes the agreed price and the request is
    ACCEPTED. Only the customer can do this, so the shop cannot settle a price on its own."""
    co = await _load(session, custom_order_id, lock=True)
    if co.customer_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Custom order not found")
    if co.status != S.IN_DISCUSSION or co.proposed_price_paisa is None:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "NO_PROPOSAL",
            "There is no price waiting for your confirmation",
        )
    if co.proposed_price_paisa != price_paisa:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "PRICE_CHANGED",
            "The shop changed the price. Please look at the new price before confirming.",
        )
    co.agreed_price_paisa = price_paisa
    co.status = S.ACCEPTED
    _note(session, co, CustomOrderMessageSender.CUSTOMER, f"I accept {format_price(price_paisa)}.")
    await events.custom_order_accepted(session, co, by_customer=True)
    await session.commit()
    return await _load(session, custom_order_id, lock=False)


def _note(
    session: AsyncSession, co: CustomOrder, sender: CustomOrderMessageSender, body: str
) -> None:
    """A line in the discussion that records a price step, so both sides can read the history.
    It does not send its own notification: the price event does."""
    session.add(CustomOrderMessage(custom_order_id=co.custom_order_id, sender=sender, body=body))


async def _load_mine_in_discussion(
    session: AsyncSession, user: AuthUser, custom_order_id: uuid.UUID
) -> CustomOrder:
    co = await _load(session, custom_order_id, lock=True)
    if co.customer_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Custom order not found")
    if co.status != S.IN_DISCUSSION:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "INVALID_TRANSITION",
            "Prices can be negotiated only while the request is being discussed",
        )
    return co


async def decline_price(
    session: AsyncSession, user: AuthUser, custom_order_id: uuid.UUID
) -> CustomOrder:
    """The customer turns down the proposed price. The request stays in discussion."""
    co = await _load_mine_in_discussion(session, user, custom_order_id)
    if co.proposed_price_paisa is None:
        raise _problem(
            status.HTTP_409_CONFLICT, "NO_PROPOSAL", "There is no price waiting for your answer"
        )
    declined = co.proposed_price_paisa
    co.proposed_price_paisa = None
    _note(session, co, CustomOrderMessageSender.CUSTOMER, f"I decline {format_price(declined)}.")
    await events.custom_order_price_declined(session, co, declined)
    await session.commit()
    return await _load(session, custom_order_id, lock=False)


async def offer_price(
    session: AsyncSession, user: AuthUser, custom_order_id: uuid.UUID, price_paisa: int
) -> CustomOrder:
    """The customer answers with an offer of their own (replacing any earlier offer and the
    shop's open proposal). The shop accepts it or proposes another price."""
    co = await _load_mine_in_discussion(session, user, custom_order_id)
    co.customer_offer_paisa = price_paisa
    co.proposed_price_paisa = None
    _note(
        session,
        co,
        CustomOrderMessageSender.CUSTOMER,
        f"I would like to offer {format_price(price_paisa)}.",
    )
    await events.custom_order_customer_offer(session, co)
    await session.commit()
    return await _load(session, custom_order_id, lock=False)


async def accept_offer(
    session: AsyncSession, custom_order_id: uuid.UUID, price_paisa: int
) -> CustomOrder:
    """The admin accepts the customer's own offer: the customer proposed it, so no further
    confirmation is needed. The price shown must still be the current offer."""
    co = await _load(session, custom_order_id, lock=True)
    if co.status != S.IN_DISCUSSION or co.customer_offer_paisa is None:
        raise _problem(status.HTTP_409_CONFLICT, "NO_OFFER", "There is no customer offer to accept")
    if co.customer_offer_paisa != price_paisa:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "PRICE_CHANGED",
            "The customer changed their offer. Please look at the new price.",
        )
    co.agreed_price_paisa = price_paisa
    co.customer_offer_paisa = None
    co.status = S.ACCEPTED
    _note(session, co, CustomOrderMessageSender.ADMIN, f"We accept {format_price(price_paisa)}.")
    await events.custom_order_accepted(session, co, by_customer=False)
    await session.commit()
    return await _load(session, custom_order_id, lock=False)


async def accept_guest_request(
    session: AsyncSession, custom_order_id: uuid.UUID, agreed_price_paisa: int
) -> CustomOrder:
    """A guest has no account to confirm in, so the admin records the price the guest agreed on
    WhatsApp. Requests from registered customers can only be accepted by the customer."""
    co = await _load(session, custom_order_id, lock=True)
    if co.customer_id is not None:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "CUSTOMER_MUST_CONFIRM",
            "Propose the price in the discussion: the customer confirms it",
        )
    if S.ACCEPTED not in ADMIN_TRANSITIONS.get(co.status, set()):
        raise _problem(
            status.HTTP_409_CONFLICT,
            "INVALID_TRANSITION",
            "Only a request that is being discussed can be accepted",
        )
    co.agreed_price_paisa = agreed_price_paisa
    co.status = S.ACCEPTED
    await events.custom_order_accepted(session, co, by_customer=False)
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
