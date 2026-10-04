import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class BusinessSettings(Base):
    """database.md §18. There is initially one active record (seeded by the migration)."""

    __tablename__ = "business_settings"
    __table_args__ = (
        CheckConstraint("delivery_fee_paisa >= 0", name="ck_business_settings_fee_nonneg"),
    )

    setting_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    business_name: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    whatsapp: Mapped[str | None] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    delivery_information: Mapped[str | None] = mapped_column(Text)
    delivery_fee_paisa: Mapped[int] = mapped_column(BigInteger, server_default="0")
    social_links: Mapped[dict | None] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
