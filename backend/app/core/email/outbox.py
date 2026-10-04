"""Send emails only for database changes that really committed.

Services call `queue_email(session, message)` while building a change. The message waits in
`session.info` and is released only by SQLAlchemy's `after_commit` event; a rollback discards it.
After the request, `send_emails` delivers the released messages best-effort: an email problem is
logged and never breaks (or rolls back) the order, payment or request that caused it.
"""

import asyncio
import logging

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.email.base import EmailMessage, EmailProvider

logger = logging.getLogger(__name__)

_PENDING = "pending_emails"
_READY = "ready_emails"
_background: set[asyncio.Task] = set()  # keeps fire-and-forget tasks alive until they finish


def queue_email(session: AsyncSession, message: EmailMessage) -> None:
    """Queue an email for the change being built. Call it inside the transaction (after the
    change's queries have run), so a rollback discards it; it is released only by the commit."""
    session.info.setdefault(_PENDING, []).append(message)


@event.listens_for(Session, "after_commit")
def _release_on_commit(session: Session) -> None:
    pending = session.info.pop(_PENDING, [])
    if pending:
        session.info.setdefault(_READY, []).extend(pending)


@event.listens_for(Session, "after_rollback")
def _discard_on_rollback(session: Session) -> None:
    session.info.pop(_PENDING, None)


def take_ready(session: AsyncSession) -> list[EmailMessage]:
    return session.info.pop(_READY, [])


async def send_emails(messages: list[EmailMessage], provider: EmailProvider) -> None:
    for message in messages:
        try:
            await provider.send(message)
        except Exception:
            logger.exception("Could not send email %r", message.subject)


def send_in_background(messages: list[EmailMessage], provider: EmailProvider) -> None:
    if not messages:
        return
    task = asyncio.create_task(send_emails(messages, provider))
    _background.add(task)
    task.add_done_callback(_background.discard)
