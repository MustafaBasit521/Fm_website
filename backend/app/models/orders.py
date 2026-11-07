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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.enums import (
    OrderStatus,
    PaymentAttemptStatus,
    PaymentMethod,
    PaymentRejectionReason,
    PaymentStatus,
)


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
    # Set by the expiry function when an unpaid order's payment window ran out; the scheduled job
    # then tells the customer (expiry_notified_at) exactly once.
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expiry_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
        CheckConstraint(
            "(paid_marked_by IS NULL) = (paid_marked_at IS NULL)", name="ck_payments_marked_paid"
        ),
        Index("ix_payments_order_id", "order_id"),
    )

    payment_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.order_id", ondelete="RESTRICT"))
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod, name="payment_method"))
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus, name="payment_status"))
    amount_paisa: Mapped[int] = mapped_column(BigInteger)
    refunded_amount_paisa: Mapped[int] = mapped_column(BigInteger, server_default="0")
    provider_reference: Mapped[str | None] = mapped_column(Text, unique=True)
    # Easypaisa / JazzCash "Mark as paid" (business-rules §13): the admin saw the money in the
    # shop's own wallet app. Who and when come from the verified token and the database clock;
    # the wallet's transaction number and a note are optional.
    paid_marked_by: Mapped[uuid.UUID | None] = mapped_column()
    paid_marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_reference: Mapped[str | None] = mapped_column(Text)
    paid_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    order: Mapped[Order] = relationship(back_populates="payments")
    refunds: Mapped[list["PaymentRefund"]] = relationship(
        back_populates="payment", order_by="PaymentRefund.created_at"
    )
    # Easypaisa / JazzCash: every time the customer sent a transaction number and a receipt.
    attempts: Mapped[list["PaymentAttempt"]] = relationship(
        back_populates="payment", order_by="PaymentAttempt.created_at"
    )

    @property
    def open_attempt(self) -> "PaymentAttempt | None":
        """The submission the admin has not decided yet."""
        return next((a for a in self.attempts if a.status == PaymentAttemptStatus.SUBMITTED), None)


class PaymentRefund(Base):
    """database.md §11b. One row per recorded refund step (a partial refund is several rows), so
    a dispute can be traced: how much, who recorded it, and the wallet transaction that sent the
    money back (Easypaisa / JazzCash refunds are made by the shop itself)."""

    __tablename__ = "payment_refunds"
    __table_args__ = (
        CheckConstraint("amount_paisa > 0", name="ck_payment_refunds_amount_positive"),
        Index("ix_payment_refunds_payment_id", "payment_id"),
    )

    refund_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    payment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payments.payment_id", ondelete="RESTRICT")
    )
    amount_paisa: Mapped[int] = mapped_column(BigInteger)
    wallet_reference: Mapped[str | None] = mapped_column(Text)
    # The admin (Supabase Auth user id, from the verified token) who recorded it.
    recorded_by: Mapped[uuid.UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    payment: Mapped[Payment] = relationship(back_populates="refunds")


class PaymentAttempt(Base):
    """database.md §11a. One submission by the customer for a manual (Easypaisa / JazzCash)
    payment: a transaction number and a receipt screenshot. A rejected attempt is kept as history;
    a corrected submission is a new row. Only an admin moves an attempt to PAID or REJECTED."""

    __tablename__ = "payment_attempts"
    __table_args__ = (
        CheckConstraint("amount_paisa >= 0", name="ck_payment_attempts_amount_nonneg"),
        CheckConstraint(
            "(status = 'SUBMITTED' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR "
            "(status IN ('PAID', 'REJECTED') AND reviewed_by IS NOT NULL "
            "AND reviewed_at IS NOT NULL)",
            name="ck_payment_attempts_review",
        ),
        CheckConstraint(
            "(status = 'REJECTED') = (rejection_reason IS NOT NULL)",
            name="ck_payment_attempts_reason",
        ),
        CheckConstraint(
            "rejection_reason IS DISTINCT FROM 'OTHER' "
            "OR coalesce(length(btrim(rejection_note)), 0) > 0",
            name="ck_payment_attempts_other_note",
        ),
        CheckConstraint(
            "length(btrim(transaction_reference)) > 0", name="ck_payment_attempts_reference"
        ),
        Index("ix_payment_attempts_order_id", "order_id"),
        Index("ix_payment_attempts_status_created", "status", "created_at"),
        # One undecided submission per payment.
        Index(
            "uq_payment_attempts_open",
            "payment_id",
            unique=True,
            postgresql_where=text("status = 'SUBMITTED'"),
        ),
        # A transaction number can back only one live (not rejected) attempt.
        Index(
            "uq_payment_attempts_reference",
            text("lower(transaction_reference)"),
            unique=True,
            postgresql_where=text("status <> 'REJECTED'"),
        ),
        Index("uq_payment_attempts_receipt", "receipt_path", unique=True),
    )

    attempt_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    payment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payments.payment_id", ondelete="RESTRICT")
    )
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.order_id", ondelete="RESTRICT"))
    # What was due when the customer submitted (the server's order total, never the browser's).
    amount_paisa: Mapped[int] = mapped_column(BigInteger)
    transaction_reference: Mapped[str] = mapped_column(Text)
    # In the PRIVATE payment-proofs bucket.
    receipt_path: Mapped[str] = mapped_column(Text)
    status: Mapped[PaymentAttemptStatus] = mapped_column(
        Enum(PaymentAttemptStatus, name="payment_attempt_status"),
        server_default=PaymentAttemptStatus.SUBMITTED.value,
    )
    rejection_reason: Mapped[PaymentRejectionReason | None] = mapped_column(
        Enum(PaymentRejectionReason, name="payment_rejection_reason")
    )
    rejection_note: Mapped[str | None] = mapped_column(Text)
    # The admin (Supabase Auth user id, from the verified token) who decided.
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column()
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    payment: Mapped[Payment] = relationship(back_populates="attempts")
    order: Mapped[Order] = relationship()
