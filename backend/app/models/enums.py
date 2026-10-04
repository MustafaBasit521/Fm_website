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


class GalleryImageType(enum.StrEnum):
    """PostgreSQL enum `gallery_image_type` (database.md §3)."""

    SHOP = "SHOP"
    DESIGN = "DESIGN"
    BEHIND_THE_SCENES = "BEHIND_THE_SCENES"
    CUSTOMER_PHOTO = "CUSTOMER_PHOTO"
    OTHER = "OTHER"


class MessageStatus(enum.StrEnum):
    """PostgreSQL enum `message_status`."""

    NEW = "NEW"
    READ = "READ"
    REPLIED = "REPLIED"
    ARCHIVED = "ARCHIVED"


class CustomOrderStatus(enum.StrEnum):
    """PostgreSQL enum `custom_order_status` (values decided in Phase 8)."""

    NEW = "NEW"
    IN_DISCUSSION = "IN_DISCUSSION"
    ACCEPTED = "ACCEPTED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    DECLINED = "DECLINED"
    CANCELLED = "CANCELLED"


class NotificationType(enum.StrEnum):
    """PostgreSQL enum `notification_type` (database.md §17). NEW_PRODUCT arrives in Phase 9."""

    ORDER_PLACED = "ORDER_PLACED"
    ORDER_CONFIRMED = "ORDER_CONFIRMED"
    ORDER_STATUS_CHANGED = "ORDER_STATUS_CHANGED"
    ORDER_SHIPPED = "ORDER_SHIPPED"
    ORDER_DELIVERED = "ORDER_DELIVERED"
    PAYMENT_SUCCESS = "PAYMENT_SUCCESS"
    PAYMENT_FAILURE = "PAYMENT_FAILURE"
    NEW_PRODUCT = "NEW_PRODUCT"
    CUSTOM_ORDER_UPDATE = "CUSTOM_ORDER_UPDATE"


class NotificationStatus(enum.StrEnum):
    """PostgreSQL enum `notification_status`."""

    UNREAD = "UNREAD"
    READ = "READ"
