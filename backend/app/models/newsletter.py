import uuid
from datetime import datetime

from sqlalchemy import DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class NewsletterSubscriber(Base):
    """database.md §29: a visitor (guest) who asked to hear about new pieces by email.

    Registered customers use `customers.subscribed_to_updates` instead. The unsubscribe token is
    an unguessable secret that lives only in the emails sent to this address."""

    __tablename__ = "newsletter_subscribers"

    subscriber_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(Text, unique=True)  # stored lower-case
    unsubscribe_token: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
