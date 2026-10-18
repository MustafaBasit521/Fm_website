"""Orders whose 30-minute payment window ran out (business-rules §13).

Cancelling them and returning their stock is done by the database function
`expire_unpaid_online_orders()`, which Supabase pg_cron also runs every minute. That function marks
what it cancelled (`orders.expired_at`). This module finishes the job: it runs the function, then
tells the customer and the shop about each newly expired order exactly once.
"""

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orders import Order
from app.services import checkout as checkout_service
from app.services import events
from app.services import orders as orders_service

logger = logging.getLogger(__name__)

BATCH = 50  # a long outage is caught up over several calls, never in one huge request


async def expire_and_notify(session: AsyncSession) -> dict[str, int]:
    expired = await checkout_service.expire_unpaid_orders(session)
    ids = (
        await session.scalars(
            select(Order.order_id)
            .where(Order.expired_at.is_not(None), Order.expiry_notified_at.is_(None))
            .order_by(Order.expired_at)
            .limit(BATCH)
        )
    ).all()
    notified = 0
    for order_id in ids:
        # one order per transaction, so a failed email queue never blocks the others
        order = await orders_service.load_order(session, order_id, lock=True)
        if order.expiry_notified_at is not None:  # another run announced it meanwhile
            await session.rollback()
            continue
        await events.order_expired(session, order)
        order.expiry_notified_at = func.now()
        await session.commit()
        notified += 1
    return {"expired": expired, "notified": notified}
