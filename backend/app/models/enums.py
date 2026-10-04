import enum


class ProductAvailability(enum.StrEnum):
    """PostgreSQL enum `product_availability` (database.md §3)."""

    READY_TO_SHIP = "READY_TO_SHIP"
    MADE_TO_ORDER = "MADE_TO_ORDER"
