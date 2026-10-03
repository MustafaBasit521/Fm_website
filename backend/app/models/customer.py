import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Text, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Customer(Base):
    """database.md §4. `customer_id` is the Supabase Auth user ID; no password is stored."""

    __tablename__ = "customers"

    customer_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(Text, unique=True)
    phone: Mapped[str | None] = mapped_column(Text)
    subscribed_to_updates: Mapped[bool] = mapped_column(Boolean, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
