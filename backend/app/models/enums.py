import enum


class ProductAvailability(enum.StrEnum):
    """PostgreSQL enum `product_availability` (database.md §3)."""

    READY_TO_SHIP = "READY_TO_SHIP"
    MADE_TO_ORDER = "MADE_TO_ORDER"


class OrderStatus(enum.StrEnum):
    """PostgreSQL enum `order_status` (database.md §3)."""

    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    PROCESSING = "PROCESSING"
    SHIPPED = "SHIPPED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


# Orders in these statuses consume made-to-order capacity (business-rules §1).
ACTIVE_ORDER_STATUSES = (OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PROCESSING)


class PaymentStatus(enum.StrEnum):
    """PostgreSQL enum `payment_status`."""

    PENDING = "PENDING"
    PAID = "PAID"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED"
    REFUNDED = "REFUNDED"
    FAILED = "FAILED"  # a failed online attempt; each attempt has its own payments row


class PaymentMethod(enum.StrEnum):
    """PostgreSQL enum `payment_method`."""

    COD = "COD"
    ONLINE = "ONLINE"
