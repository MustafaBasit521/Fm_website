"""Email list for visitors who want to hear about new pieces (business-rules §7 Newsletter, §31)."""

import secrets

from fastapi import HTTPException, status
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.newsletter import NewsletterSubscriber
from app.services import events


async def subscribe(session: AsyncSession, email: str) -> None:
    """Add an address. Subscribing twice is a harmless no-op, and the caller always gets the same
    answer, so nobody can use this to find out which addresses are already on the list."""
    token = secrets.token_urlsafe(24)
    result = await session.execute(
        insert(NewsletterSubscriber)
        .values(email=email, unsubscribe_token=token)
        .on_conflict_do_nothing(index_elements=[NewsletterSubscriber.email])
        .returning(NewsletterSubscriber.subscriber_id)
    )
    is_new = result.scalar_one_or_none() is not None
    if is_new:  # the welcome email (with the unsubscribe link) goes out once, after the commit
        await events.newsletter_welcome(session, email, token)
    await session.commit()


async def unsubscribe(session: AsyncSession, token: str) -> None:
    result = await session.execute(
        delete(NewsletterSubscriber).where(NewsletterSubscriber.unsubscribe_token == token)
    )
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link is no longer valid")
