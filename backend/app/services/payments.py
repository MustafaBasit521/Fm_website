"""Online payment attempts, verification, COD confirmation and refunds
(business-rules §13, §18, §20–22; database.md §11).

Lock order is always: order row first, then (implicitly) its payments. Every state change to an
order or its payments goes through the order lock, so a webhook, a customer's return visit, an
admin cancel and the expiry job cannot interleave.
"""

import logging
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.payments.base import PaymentProvider, ProviderError, ProviderStatus
from app.models.enums import OrderStatus, PaymentMethod, PaymentStatus
from app.models.orders import Order, Payment
from app.schemas.orders import InitiatePayment, PaymentProofCreate, PaymentStatusRead
from app.services import checkout as checkout_service
from app.services import events
from app.services import orders as orders_service

logger = logging.getLogger(__name__)


def _problem(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message})


async def _deadline_passed(session: AsyncSession, order: Order) -> bool:
    """Has the 30-minute window closed? Compared by the database against its own clock (the
    deadline was set from it), so there is no clock skew between app and database."""
    passed = await session.scalar(
        select(Order.payment_deadline_at <= func.now()).where(Order.order_id == order.order_id)
    )
    return bool(passed)  # NULL (no deadline, e.g. COD) is not "passed"


def _provider_down() -> HTTPException:
    return _problem(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "The payment service is temporarily unavailable. Please try again.",
    )


# ---- applying a verified provider result ---------------------------------------------------


async def _apply_verified(
    session: AsyncSession, order: Order, payment: Payment, provider: PaymentProvider
) -> str:
    """Ask the provider what really happened and update state (order lock already held).

    Returns a short outcome label. The frontend and the webhook body are never trusted: only
    `provider.verify` decides (business-rules §21). Safe to repeat (idempotent).
    """
    assert payment.provider_reference is not None
    info = await provider.verify(payment.provider_reference)

    if info.status == ProviderStatus.PAID:
        if payment.status in orders_service.MONEY_HELD:
            return "already_paid"  # duplicate notification: nothing to do
        if info.amount_paisa != payment.amount_paisa:
            # Never confirm an order on a wrong amount. Leave it for a human to look at.
            logger.error(
                "Payment amount mismatch for order %s: provider says %s, expected %s",
                order.order_id,
                info.amount_paisa,
                payment.amount_paisa,
            )
            return "amount_mismatch"
        payment.status = PaymentStatus.PAID
        if order.status == OrderStatus.PENDING:
            if await _deadline_passed(session, order):
                # Paid after the window closed but before the expiry job ran: same as a late
                # payment. The order is cancelled and the full amount is owed back.
                await orders_service.apply_cancellation(session, order, 0, False)
                await events.payment_received(session, order, late=True)
                return "paid_late"
            order.status = OrderStatus.CONFIRMED  # business-rules §13: verified payment
            await events.payment_received(session, order)
            await events.order_status_changed(session, order, OrderStatus.CONFIRMED)
            return "paid"
        if order.status == OrderStatus.CANCELLED:
            # Decided: the order stays cancelled; the payment is recorded and refundable in
            # full (cancellation_charge is 0, so refund_due = the amount paid).
            await events.payment_received(session, order, late=True)
            return "paid_late"
        return "paid"  # e.g. a second attempt paid for an already confirmed order

    if info.status == ProviderStatus.FAILED:
        if payment.status == PaymentStatus.PENDING:
            payment.status = PaymentStatus.FAILED  # does not cancel the order (§20)
            await events.payment_failed(session, order)
        return "failed"

    return "pending"


async def handle_provider_event(
    session: AsyncSession, provider: PaymentProvider, reference: str
) -> str:
    """Process a notification (webhook or the customer returning) for one attempt."""
    order_id = await session.scalar(
        select(Payment.order_id).where(Payment.provider_reference == reference)
    )
    if order_id is None:
        return "unknown_reference"  # not ours (or not created yet): acknowledge and ignore
    try:
        order = await orders_service.load_order(session, order_id, lock=True)
        payment = next(p for p in order.payments if p.provider_reference == reference)
        outcome = await _apply_verified(session, order, payment, provider)
        await session.commit()
    except ProviderError:
        await session.rollback()
        raise _provider_down() from None
    return outcome


# ---- customer: pay / return ----------------------------------------------------------------


async def initiate_payment(
    session: AsyncSession, provider: PaymentProvider, settings: Settings, order_id: uuid.UUID
) -> InitiatePayment:
    """Start (or restart) paying for an online order within its 30-minute window."""
    await checkout_service.expire_unpaid_orders(session)  # an expired order must not be payable
    try:
        order = await orders_service.load_order(session, order_id, lock=True)
        current = orders_service.current_payment(order)
        if current.method != PaymentMethod.ONLINE:
            raise _problem(status.HTTP_409_CONFLICT, "NOT_PAYABLE", "This order is not paid online")
        if current.status in orders_service.MONEY_HELD:
            raise _problem(status.HTTP_409_CONFLICT, "ALREADY_PAID", "This order is already paid")
        if order.status != OrderStatus.PENDING:
            raise _problem(
                status.HTTP_409_CONFLICT, "NOT_PAYABLE", "This order can no longer be paid"
            )
        if await _deadline_passed(session, order):
            raise _problem(
                status.HTTP_409_CONFLICT,
                "WINDOW_EXPIRED",
                "The 30-minute payment window has passed",
            )

        attempt = order.payments[-1]
        if attempt.provider_reference is not None and attempt.status == PaymentStatus.PENDING:
            # An earlier attempt may still be open: settle it before starting another.
            outcome = await _apply_verified(session, order, attempt, provider)
            await session.commit()
            if outcome in ("paid", "paid_late", "already_paid"):
                raise _problem(
                    status.HTTP_409_CONFLICT, "ALREADY_PAID", "This order is already paid"
                )
            if outcome == "pending":
                raise _problem(
                    status.HTTP_409_CONFLICT,
                    "PAYMENT_IN_PROGRESS",
                    "A payment is already in progress for this order",
                )
            order = await orders_service.load_order(session, order_id, lock=True)
            attempt = order.payments[-1]

        if attempt.status == PaymentStatus.FAILED:
            # One row per attempt keeps the history of failed tries (database.md §11).
            attempt = Payment(
                order_id=order.order_id,
                method=PaymentMethod.ONLINE,
                status=PaymentStatus.PENDING,
                amount_paisa=order.total_amount_paisa,
            )
            session.add(attempt)
            await session.flush()

        checkout = await provider.create_checkout(
            order_id=order.order_id,
            payment_id=attempt.payment_id,
            amount_paisa=attempt.amount_paisa,
            customer_email=order.customer_email,
            return_url=f"{settings.frontend_url}/payment/return?order={order.order_id}",
        )
        attempt.provider_reference = checkout.reference
        await session.commit()
        return InitiatePayment(payment_id=attempt.payment_id, redirect_url=checkout.redirect_url)
    except ProviderError:
        await session.rollback()
        raise _provider_down() from None
    except HTTPException:
        await session.rollback()
        raise


async def refresh_payment(
    session: AsyncSession, provider: PaymentProvider, order_id: uuid.UUID
) -> PaymentStatusRead:
    """The customer came back from the gateway: verify the latest attempt and report."""
    order = await orders_service.load_order(session, order_id, lock=False)
    latest = order.payments[-1]
    if latest.provider_reference and latest.status == PaymentStatus.PENDING:
        await handle_provider_event(session, provider, latest.provider_reference)
        order = await orders_service.load_order(session, order_id, lock=False)
    current = orders_service.current_payment(order)
    return PaymentStatusRead(order_status=order.status, payment_status=current.status)


# ---- admin ---------------------------------------------------------------------------------


async def confirm_cod_payment(session: AsyncSession, order_id: uuid.UUID) -> Order:
    """business-rules §20: when the order is Delivered and the admin confirms the cash was
    received, the COD payment becomes Paid."""
    order = await orders_service.load_order(session, order_id, lock=True)
    payment = orders_service.current_payment(order)
    if payment.method != PaymentMethod.COD:
        raise _problem(status.HTTP_409_CONFLICT, "NOT_COD", "This is not a cash-on-delivery order")
    if payment.status != PaymentStatus.PENDING:
        raise _problem(status.HTTP_409_CONFLICT, "ALREADY_PAID", "Payment was already recorded")
    if order.status != OrderStatus.DELIVERED:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "NOT_DELIVERED",
            "Cash payment can be confirmed only after the order is delivered",
        )
    payment.status = PaymentStatus.PAID
    await events.payment_received(session, order)
    await session.commit()
    return await orders_service.load_order(session, order_id, lock=False)


async def refund_order(
    session: AsyncSession,
    provider: PaymentProvider | None,
    order_id: uuid.UUID,
    amount_paisa: int | None,
) -> Order:
    """Refund (all or part of) what a cancelled, paid online order still owes the customer.

    refund due = amount paid - cancellation charge - already refunded (business-rules §18, §22).
    The refunded amount can never exceed the original payment.
    """
    order = await orders_service.load_order(session, order_id, lock=True)
    payment: Payment | None = next(
        (
            p
            for p in order.payments
            if p.status in (PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED)
        ),
        None,
    )
    if order.status != OrderStatus.CANCELLED:
        raise _problem(
            status.HTTP_409_CONFLICT, "NOT_CANCELLED", "Only cancelled orders can be refunded"
        )
    manual = payment is not None and payment.method == PaymentMethod.TRANSFER
    if payment is None or not (
        manual or (payment.method == PaymentMethod.ONLINE and payment.provider_reference)
    ):
        raise _problem(status.HTTP_409_CONFLICT, "NOTHING_TO_REFUND", "There is nothing to refund")

    due = payment.amount_paisa - order.cancellation_charge_paisa - payment.refunded_amount_paisa
    if due <= 0:
        raise _problem(
            status.HTTP_409_CONFLICT, "NOTHING_TO_REFUND", "There is nothing left to refund"
        )
    amount = due if amount_paisa is None else amount_paisa
    if amount > due:
        raise _problem(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "REFUND_TOO_LARGE",
            f"At most {due} paisa can still be refunded",
        )

    if not manual:
        if provider is None:
            raise _provider_down()
        # The key makes a retried request safe: the provider will not refund the same step twice.
        assert payment.provider_reference is not None
        key = f"{payment.payment_id}:{payment.refunded_amount_paisa}:{amount}"
        try:
            await provider.refund(payment.provider_reference, amount, key)
        except ProviderError:
            await session.rollback()
            raise _problem(
                status.HTTP_502_BAD_GATEWAY,
                "REFUND_FAILED",
                "The payment provider could not process the refund. Nothing was changed.",
            ) from None
    # A transfer is refunded by the shop itself (it sends the money back from its own account);
    # here the admin only records that it did.

    payment.refunded_amount_paisa += amount
    payment.status = (
        PaymentStatus.REFUNDED
        if payment.refunded_amount_paisa >= payment.amount_paisa
        else PaymentStatus.PARTIALLY_REFUNDED
    )
    await session.commit()
    return await orders_service.load_order(session, order_id, lock=False)


def webhook_headers(raw: Any) -> dict[str, str]:
    return {k.lower(): v for k, v in raw.items()}


# ---- payment by transfer (the shop's own account; the admin checks the proof) ---------------


def _transfer_payment(order: Order) -> Payment:
    payment = next((p for p in order.payments if p.method == PaymentMethod.TRANSFER), None)
    if payment is None:
        raise _problem(
            status.HTTP_409_CONFLICT, "NOT_A_TRANSFER", "This order is not paid by transfer"
        )
    return payment


async def submit_transfer_proof(
    session: AsyncSession, order_id: uuid.UUID, data: PaymentProofCreate
) -> Order:
    """The customer says they sent the money. This stops the 30-minute clock (the shop needs time
    to check) and tells the shop. The payment stays Pending until the admin confirms it."""
    order = await orders_service.load_order(session, order_id, lock=True)
    payment = _transfer_payment(order)
    if order.status != OrderStatus.PENDING or payment.status != PaymentStatus.PENDING:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "PAYMENT_CLOSED",
            "This order can no longer receive payment details. If you already paid, please "
            "contact the shop.",
        )
    if await _deadline_passed(session, order):
        raise _problem(
            status.HTTP_409_CONFLICT,
            "PAYMENT_WINDOW_CLOSED",
            "The 30 minutes for this payment have passed. If you already paid, please contact the "
            "shop.",
        )
    payment.proof_reference = data.reference
    payment.proof_image_path = data.image_path
    payment.proof_submitted_at = func.now()
    order.payment_deadline_at = None  # the shop is checking: the order does not expire meanwhile
    await session.flush()
    await session.refresh(payment)
    await events.transfer_proof_received(session, order)
    await session.commit()
    return await orders_service.load_order(session, order_id, lock=False)


async def confirm_transfer(session: AsyncSession, order_id: uuid.UUID) -> Order:
    """The admin saw the money in the shop's account: the payment is Paid and the order is
    Confirmed (business-rules §13, the same outcome as a verified online payment)."""
    order = await orders_service.load_order(session, order_id, lock=True)
    payment = _transfer_payment(order)
    if payment.status != PaymentStatus.PENDING:
        raise _problem(status.HTTP_409_CONFLICT, "ALREADY_PAID", "Payment was already recorded")
    if order.status != OrderStatus.PENDING:
        raise _problem(
            status.HTTP_409_CONFLICT,
            "INVALID_TRANSITION",
            "Only a pending order can be confirmed by receiving its payment",
        )
    payment.status = PaymentStatus.PAID
    order.status = OrderStatus.CONFIRMED
    order.payment_deadline_at = None
    await events.payment_received(session, order)
    await events.order_status_changed(session, order, OrderStatus.CONFIRMED)
    await session.commit()
    return await orders_service.load_order(session, order_id, lock=False)


async def reject_transfer_proof(session: AsyncSession, order_id: uuid.UUID) -> Order:
    """The admin could not find the money: the proof is cleared and the customer gets a fresh
    30 minutes to send correct details."""
    order = await orders_service.load_order(session, order_id, lock=True)
    payment = _transfer_payment(order)
    if (
        order.status != OrderStatus.PENDING
        or payment.status != PaymentStatus.PENDING
        or payment.proof_submitted_at is None
    ):
        raise _problem(
            status.HTTP_409_CONFLICT,
            "NO_PROOF",
            "There are no payment details waiting to be checked",
        )
    payment.proof_reference = None
    payment.proof_image_path = None
    payment.proof_submitted_at = None
    order.payment_deadline_at = func.now() + checkout_service.PAYMENT_WINDOW
    await events.transfer_proof_rejected(session, order)
    await session.commit()
    return await orders_service.load_order(session, order_id, lock=False)


async def ensure_proof_can_be_sent(session: AsyncSession, order_id: uuid.UUID) -> None:
    """A signed upload is handed out only for an open transfer order (so the bucket cannot be
    used by anyone who merely guesses an address)."""
    order = await orders_service.load_order(session, order_id, lock=False)
    payment = _transfer_payment(order)
    if order.status != OrderStatus.PENDING or payment.status != PaymentStatus.PENDING:
        raise _problem(
            status.HTTP_409_CONFLICT, "PAYMENT_CLOSED", "This order can no longer receive payment"
        )
