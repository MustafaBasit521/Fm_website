import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Text,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.enums import OrderStatus, PaymentMethod, PaymentStatus


class Order(Base):
    """database.md §9. Customer, delivery and price data are snapshots, so history stays
    meaningful after products, addresses or accounts change."""

    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("subtotal_paisa >= 0", name="ck_orders_subtotal_nonneg"),
        CheckConstraint("delivery_fee_paisa >= 0", name="ck_orders_delivery_fee_nonneg"),
        CheckConstraint(
            "total_amount_paisa = subtotal_paisa + delivery_fee_paisa", name="ck_orders_total_sum"
        ),
        CheckConstraint("cancellation_charge_paisa >= 0", name="ck_orders_charge_nonneg"),
        Index("ix_orders_customer_id", "customer_id"),
        Index("ix_orders_status", "status"),
        Index("ix_orders_created_at", "created_at"),
        Index("ix_orders_payment_deadline_at", "payment_deadline_at"),
    )

    order_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # NULL for guest orders and for orders whose customer account was deleted.
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customers.customer_id", ondelete="SET NULL")
    )

    customer_name: Mapped[str] = mapped_column(Text)
    customer_email: Mapped[str] = mapped_column(Text)
    customer_phone: Mapped[str | None] = mapped_column(Text)

    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, name="order_status"))

    delivery_name: Mapped[str] = mapped_column(Text)
    delivery_house_no: Mapped[str] = mapped_column(Text)
    delivery_street_number: Mapped[str | None] = mapped_column(Text)
    delivery_city: Mapped[str] = mapped_column(Text)
    delivery_province: Mapped[str | None] = mapped_column(Text)
    delivery_postal_code: Mapped[str] = mapped_column(Text)
    delivery_country: Mapped[str] = mapped_column(Text)

    subtotal_paisa: Mapped[int] = mapped_column(BigInteger)
    delivery_fee_paisa: Mapped[int] = mapped_column(BigInteger, server_default="0")
    total_amount_paisa: Mapped[int] = mapped_column(BigInteger)

    payment_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_charge_paisa: Mapped[int] = mapped_column(BigInteger, server_default="0")
    charge_waived: Mapped[bool] = mapped_column(Boolean, server_default=false())

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", order_by="OrderItem.product_name_snapshot"
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="order", order_by="Payment.created_at"
    )


class OrderItem(Base):
    """database.md §10."""

    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_items_quantity_positive"),
        CheckConstraint("unit_price_at_purchase_paisa >= 0", name="ck_order_items_price_nonneg"),
        Index("ix_order_items_order_id", "order_id"),
        Index("ix_order_items_product_id", "product_id"),
    )

    order_item_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Orders are historical records and are never deleted, so RESTRICT is the safe default.
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.order_id", ondelete="RESTRICT"))
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("products.product_id", ondelete="SET NULL")
    )
    product_name_snapshot: Mapped[str] = mapped_column(Text)
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price_at_purchase_paisa: Mapped[int] = mapped_column(BigInteger)

    order: Mapped[Order] = relationship(back_populates="items")


class Payment(Base):
    """database.md §11. One PENDING row is created with each order; how retries are recorded
    is decided with the payments phase (open decision in progress.md)."""

    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount_paisa >= 0", name="ck_payments_amount_nonneg"),
        CheckConstraint("refunded_amount_paisa >= 0", name="ck_payments_refunded_nonneg"),
        CheckConstraint("refunded_amount_paisa <= amount_paisa", name="ck_payments_refund_cap"),
        Index("ix_payments_order_id", "order_id"),
    )

    payment_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.order_id", ondelete="RESTRICT"))
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod, name="payment_method"))
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus, name="payment_status"))
    amount_paisa: Mapped[int] = mapped_column(BigInteger)
    refunded_amount_paisa: Mapped[int] = mapped_column(BigInteger, server_default="0")
    provider_reference: Mapped[str | None] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    order: Mapped[Order] = relationship(back_populates="payments")
