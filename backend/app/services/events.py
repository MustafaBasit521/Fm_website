"""Business events -> in-app notifications and emails (business-rules §31).

Every function runs inside the caller's transaction, right before its commit:

* the in-app `notifications` row is committed (or rolled back) together with the change itself;
* emails are only *queued*; the outbox releases them after the commit succeeds and sends them
  best-effort, so a mail problem never breaks an order.

In-app notifications exist only for registered customers (guests have no account to read them
in); guests are reached by email at the address they gave. Notifications are not an email log.
"""

from sqlalchemy import func, insert, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.email.base import EmailMessage
from app.core.email.outbox import queue_email
from app.core.money import format_price
from app.models.business_settings import BusinessSettings
from app.models.catalog import Product
from app.models.customer import Customer
from app.models.engagement import CustomOrder, Message, Notification
from app.models.enums import (
    CustomOrderStatus,
    NotificationStatus,
    NotificationType,
    OrderStatus,
    PaymentMethod,
)
from app.models.orders import Order

SHOP = "Crochet Shop"

_STATUS_EVENTS: dict[OrderStatus, tuple[NotificationType, str, str]] = {
    OrderStatus.CONFIRMED: (
        NotificationType.ORDER_CONFIRMED,
        "Order confirmed",
        "Your order is confirmed. We will start preparing it soon.",
    ),
    OrderStatus.PROCESSING: (
        NotificationType.ORDER_STATUS_CHANGED,
        "Order being prepared",
        "We have started preparing your order.",
    ),
    OrderStatus.SHIPPED: (
        NotificationType.ORDER_SHIPPED,
        "Order shipped",
        "Your order is on its way.",
    ),
    OrderStatus.DELIVERED: (
        NotificationType.ORDER_DELIVERED,
        "Order delivered",
        "Your order has been delivered. You can now review the products you bought.",
    ),
    OrderStatus.CANCELLED: (
        NotificationType.ORDER_STATUS_CHANGED,
        "Order cancelled",
        "Your order has been cancelled.",
    ),
}

_CUSTOM_STATUS_TEXT: dict[CustomOrderStatus, str] = {
    CustomOrderStatus.NEW: "We received your custom order request.",
    CustomOrderStatus.IN_DISCUSSION: "We are discussing the details of your custom order with you.",
    CustomOrderStatus.ACCEPTED: "Your custom order has been accepted.",
    CustomOrderStatus.IN_PROGRESS: "We have started making your custom order.",
    CustomOrderStatus.COMPLETED: "Your custom order is complete.",
    CustomOrderStatus.DECLINED: "Sorry, we are unable to make your custom order.",
    CustomOrderStatus.CANCELLED: "Your custom order has been cancelled.",
}


def short_ref(order: Order) -> str:
    return str(order.order_id)[:8].upper()


def _items_text(order: Order) -> str:
    return "\n".join(
        f"  {i.quantity} x {i.product_name_snapshot} - "
        f"{format_price(i.quantity * i.unit_price_at_purchase_paisa)}"
        for i in order.items
    )


async def _business_email(session: AsyncSession) -> str | None:
    return await session.scalar(
        select(BusinessSettings.email).order_by(BusinessSettings.updated_at.desc()).limit(1)
    )


def _notify(
    session: AsyncSession,
    customer_id,
    kind: NotificationType,
    title: str,
    message: str,
) -> None:
    if customer_id is None:
        return  # guests have no in-app inbox
    session.add(
        Notification(
            customer_id=customer_id,
            type=kind,
            title=title,
            message=message,
            status=NotificationStatus.UNREAD,
        )
    )


async def _alert_shop(session: AsyncSession, subject: str, body: str) -> None:
    to = await _business_email(session)
    if to:
        queue_email(session, EmailMessage(to=to, subject=f"[{SHOP}] {subject}", body=body))


# ---- orders --------------------------------------------------------------------------------


async def order_placed(session: AsyncSession, order: Order) -> None:
    ref = short_ref(order)
    total = format_price(order.total_amount_paisa)
    _notify(
        session,
        order.customer_id,
        NotificationType.ORDER_PLACED,
        "Order placed",
        f"We received your order {ref}. Total: {total}.",
    )
    online = any(p.method == PaymentMethod.ONLINE for p in order.payments)
    payment_line = (
        "Please complete your online payment within 30 minutes, or the order will be cancelled."
        if online
        else "You will pay cash on delivery."
    )
    queue_email(
        session,
        EmailMessage(
            to=order.customer_email,
            subject=f"We received your order {ref}",
            body=(
                f"Hi {order.customer_name},\n\nThank you for your order {ref}.\n\n"
                f"{_items_text(order)}\n\n"
                f"Subtotal: {format_price(order.subtotal_paisa)}\n"
                f"Delivery: {format_price(order.delivery_fee_paisa)}\n"
                f"Total: {total}\n\n{payment_line}\n\n"
                f"Delivering to: {order.delivery_name}, {order.delivery_house_no}, "
                f"{order.delivery_city}, {order.delivery_postal_code}\n\n- {SHOP}"
            ),
        ),
    )
    await _alert_shop(
        session,
        f"New order {ref}",
        f"{order.customer_name} placed order {ref} for {total} "
        f"({'online' if online else 'cash on delivery'}).",
    )


async def order_status_changed(
    session: AsyncSession, order: Order, new_status: OrderStatus
) -> None:
    event = _STATUS_EVENTS.get(new_status)
    if event is None:
        return  # Pending is the starting state; nothing to announce
    kind, title, text = event
    ref = short_ref(order)
    _notify(session, order.customer_id, kind, title, f"Order {ref}: {text}")
    queue_email(
        session,
        EmailMessage(
            to=order.customer_email,
            subject=f"{title} - order {ref}",
            body=f"Hi {order.customer_name},\n\n{text}\n\nOrder: {ref}\n\n- {SHOP}",
        ),
    )


async def payment_received(session: AsyncSession, order: Order, *, late: bool = False) -> None:
    ref = short_ref(order)
    total = format_price(order.total_amount_paisa)
    if late:
        text = (
            f"We received your payment of {total} for order {ref}, but the 30-minute payment "
            "window had already passed and the order was cancelled. We will refund you in full."
        )
    else:
        text = f"We received your payment of {total} for order {ref}. Thank you!"
    _notify(session, order.customer_id, NotificationType.PAYMENT_SUCCESS, "Payment received", text)
    queue_email(
        session,
        EmailMessage(
            to=order.customer_email,
            subject=f"Payment received - order {ref}",
            body=f"Hi {order.customer_name},\n\n{text}\n\n- {SHOP}",
        ),
    )


async def payment_failed(session: AsyncSession, order: Order) -> None:
    ref = short_ref(order)
    text = (
        f"Your payment for order {ref} did not go through. You can try again while the order is "
        "reserved (30 minutes from when you placed it)."
    )
    _notify(session, order.customer_id, NotificationType.PAYMENT_FAILURE, "Payment failed", text)
    queue_email(
        session,
        EmailMessage(
            to=order.customer_email,
            subject=f"Payment failed - order {ref}",
            body=f"Hi {order.customer_name},\n\n{text}\n\n- {SHOP}",
        ),
    )


# ---- custom orders -------------------------------------------------------------------------


async def _customer_email(session: AsyncSession, custom_order: CustomOrder) -> str | None:
    # Custom orders store no email; registered customers are reached at their account email.
    if custom_order.customer_id is None:
        return None
    return await session.scalar(
        select(Customer.email).where(Customer.customer_id == custom_order.customer_id)
    )


async def custom_order_received(session: AsyncSession, custom_order: CustomOrder) -> None:
    text = _CUSTOM_STATUS_TEXT[CustomOrderStatus.NEW]
    _notify(
        session,
        custom_order.customer_id,
        NotificationType.CUSTOM_ORDER_UPDATE,
        "Custom order received",
        text,
    )
    email = await _customer_email(session, custom_order)
    if email:
        queue_email(
            session,
            EmailMessage(
                to=email,
                subject="We received your custom order request",
                body=(
                    f"Hi {custom_order.name},\n\n{text} We will contact you on WhatsApp."
                    f"\n\n- {SHOP}"
                ),
            ),
        )
    await _alert_shop(
        session,
        "New custom order request",
        f"{custom_order.name} (WhatsApp {custom_order.whatsapp_number}) sent a custom order "
        f"request:\n\n{custom_order.description}",
    )


async def custom_order_status_changed(session: AsyncSession, custom_order: CustomOrder) -> None:
    text = _CUSTOM_STATUS_TEXT[custom_order.status]
    _notify(
        session,
        custom_order.customer_id,
        NotificationType.CUSTOM_ORDER_UPDATE,
        "Custom order update",
        text,
    )
    email = await _customer_email(session, custom_order)
    if email:
        queue_email(
            session,
            EmailMessage(
                to=email,
                subject="Update on your custom order",
                body=f"Hi {custom_order.name},\n\n{text}\n\n- {SHOP}",
            ),
        )


# ---- contact messages ----------------------------------------------------------------------


async def message_received(session: AsyncSession, message: Message) -> None:
    contact = ", ".join(
        part
        for part in (
            f"email {message.email}" if message.email else "",
            f"phone {message.phone}" if message.phone else "",
            f"WhatsApp {message.whatsapp_number}" if message.whatsapp_number else "",
        )
        if part
    )
    await _alert_shop(
        session,
        "New contact message",
        f"{message.name} ({contact}) wrote:\n\n{message.message}",
    )


# ---- catalog -------------------------------------------------------------------------------


async def new_product(session: AsyncSession, product: Product) -> None:
    """Tell every customer who subscribed to shop updates that a product was published.

    One INSERT ... SELECT creates all the in-app notifications in a single statement, inside the
    caller's transaction. Only in-app: a mass email to all subscribers needs the (still unchosen)
    email provider and a proper unsubscribe flow, so it is not sent."""
    await session.execute(
        insert(Notification).from_select(
            ["notification_id", "customer_id", "type", "title", "message", "status"],
            select(
                # one id per row, generated by the database (a Python-side default would be a
                # single value shared by every row of the INSERT ... SELECT)
                func.gen_random_uuid(),
                Customer.customer_id,
                literal(NotificationType.NEW_PRODUCT, Notification.type.type),
                literal("New in the shop", Notification.title.type),
                literal(f"{product.name} is now available.", Notification.message.type),
                literal(NotificationStatus.UNREAD, Notification.status.type),
            ).where(Customer.subscribed_to_updates.is_(True)),
        )
    )
