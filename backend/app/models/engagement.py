import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.enums import (
    CustomOrderStatus,
    GalleryImageType,
    MessageStatus,
    NotificationStatus,
    NotificationType,
)


class Review(Base):
    """database.md §13. Customer and product links are SET NULL so history survives deletion;
    the product name is snapshotted. One review per customer per product."""

    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating_range"),
        UniqueConstraint("customer_id", "product_id", name="uq_reviews_customer_product"),
        Index("ix_reviews_product_id", "product_id"),
        Index("ix_reviews_order_id", "order_id"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customers.customer_id", ondelete="SET NULL")
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("products.product_id", ondelete="SET NULL")
    )
    # The delivered order that made the customer eligible. Orders are never deleted.
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.order_id", ondelete="RESTRICT"))
    product_name_snapshot: Mapped[str] = mapped_column(Text)
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GalleryImage(Base):
    """database.md §14. The file lives in Supabase Storage; this row holds the path."""

    __tablename__ = "gallery_images"
    __table_args__ = (Index("ix_gallery_images_visible_type", "is_visible", "image_type"),)

    gallery_image_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    storage_path: Mapped[str] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    image_type: Mapped[GalleryImageType] = mapped_column(
        Enum(GalleryImageType, name="gallery_image_type")
    )
    is_visible: Mapped[bool] = mapped_column(Boolean, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CustomOrder(Base):
    """database.md §15. Separate from the normal order lifecycle."""

    __tablename__ = "custom_orders"
    __table_args__ = (
        CheckConstraint(
            "budget_paisa IS NULL OR budget_paisa >= 0", name="ck_custom_orders_budget"
        ),
        Index("ix_custom_orders_customer_id", "customer_id"),
        Index("ix_custom_orders_status", "status"),
        Index("ix_custom_orders_created_at", "created_at"),
    )

    custom_order_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customers.customer_id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(Text)
    whatsapp_number: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    budget_paisa: Mapped[int | None] = mapped_column(BigInteger)
    required_date: Mapped[date | None] = mapped_column(Date)
    # Private bucket path (custom-order-references). Admin reads it through a signed URL.
    reference_image_path: Mapped[str | None] = mapped_column(Text)
    status: Mapped[CustomOrderStatus] = mapped_column(
        Enum(CustomOrderStatus, name="custom_order_status")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Message(Base):
    """database.md §16: a contact-form message."""

    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_status", "status"),)

    message_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    whatsapp_number: Mapped[str | None] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[MessageStatus] = mapped_column(Enum(MessageStatus, name="message_status"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    """database.md §17: in-app notification (not an email log)."""

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_customer_status", "customer_id", "status", "created_at"),
    )

    notification_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.customer_id", ondelete="CASCADE")
    )
    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType, name="notification_type"))
    title: Mapped[str] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[NotificationStatus] = mapped_column(
        Enum(NotificationStatus, name="notification_status"),
        server_default=NotificationStatus.UNREAD.value,
    )
    # clock_timestamp() (not now()) so notifications created in one transaction keep their order
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
