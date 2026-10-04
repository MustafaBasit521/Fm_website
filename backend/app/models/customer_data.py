import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Address(Base):
    """database.md §5. Orders keep their own address snapshot, so deleting is always safe."""

    __tablename__ = "addresses"
    __table_args__ = (Index("ix_addresses_customer_id", "customer_id"),)

    address_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.customer_id", ondelete="CASCADE")
    )
    label: Mapped[str | None] = mapped_column(Text)
    house_no: Mapped[str] = mapped_column(Text)
    street_number: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str] = mapped_column(Text)
    province: Mapped[str | None] = mapped_column(Text)
    postal_code: Mapped[str] = mapped_column(Text)
    country: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WishlistItem(Base):
    """database.md §12. UNIQUE(customer_id, product_id) is implemented as the composite primary
    key: there is no separate wishlist table or surrogate id."""

    __tablename__ = "wishlist_items"
    __table_args__ = (Index("ix_wishlist_items_product_id", "product_id"),)

    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.customer_id", ondelete="CASCADE"), primary_key=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.product_id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
