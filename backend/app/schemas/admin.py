import re
import uuid
from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
)

from app.schemas.customer import CustomerUpdate
from app.schemas.orders import AdminOrderSummary

MAX_DELIVERY_FEE_PAISA = 10_000_000  # Rs 100,000: a sanity cap against typos
_SOCIAL_KEY = re.compile(r"^[a-z0-9_]{1,30}$")


# ---- dashboard -----------------------------------------------------------------------------


class LowStockProduct(BaseModel):
    product_id: uuid.UUID
    name: str
    stock_quantity: int


class DashboardSummary(BaseModel):
    orders_by_status: dict[str, int]
    # Orders waiting for the admin: Pending cash-on-delivery orders (to confirm) and Confirmed
    # orders (to start preparing). Online orders awaiting payment are not "action needed".
    orders_needing_action: int
    new_messages: int
    new_custom_orders: int
    low_stock_threshold: int
    low_stock_products: list[LowStockProduct]
    recent_orders: list[AdminOrderSummary]


# ---- customers -----------------------------------------------------------------------------


class AdminCustomer(BaseModel):
    customer_id: uuid.UUID
    name: str
    email: str
    phone: str | None
    subscribed_to_updates: bool
    created_at: datetime
    order_count: int


class AdminCustomerDetail(AdminCustomer):
    custom_order_count: int
    recent_orders: list[AdminOrderSummary]


# ---- categories ----------------------------------------------------------------------------


class AdminCategory(BaseModel):
    category_id: uuid.UUID
    name: str
    product_count: int


# ---- business settings ---------------------------------------------------------------------


class SettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    business_name: str | None
    email: str | None
    phone: str | None
    whatsapp: str | None
    address: str | None
    delivery_information: str | None
    delivery_fee_paisa: int
    social_links: dict[str, str]


class AdminSettingsRead(SettingsRead):
    updated_at: datetime


def _blank_to_none(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class SettingsUpdate(BaseModel):
    """business-rules §33. Only the fields listed there can be changed."""

    model_config = ConfigDict(extra="forbid")

    business_name: str | None = Field(default=None, max_length=100)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)
    whatsapp: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=300)
    delivery_information: str | None = Field(default=None, max_length=2000)
    delivery_fee_paisa: int | None = Field(default=None, ge=0, le=MAX_DELIVERY_FEE_PAISA)
    social_links: dict[str, str] | None = None

    _blank = field_validator("business_name", "address", "delivery_information")(_blank_to_none)

    @field_validator("email")
    @classmethod
    def _lower_email(cls, v: str | None) -> str | None:
        return v.lower() if v else None

    @field_validator("phone", "whatsapp")
    @classmethod
    def _phones(cls, v: str | None) -> str | None:
        return CustomerUpdate(phone=v).phone if v is not None else None

    @field_validator("social_links")
    @classmethod
    def _links(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        if v is None:
            return v
        if len(v) > 10:
            raise ValueError("at most 10 social links")
        cleaned: dict[str, str] = {}
        for key, url in v.items():
            if not _SOCIAL_KEY.match(key):
                raise ValueError("link names use lowercase letters, digits and underscores")
            url = url.strip()
            # https only: these become links on the storefront, so no javascript: or data: URLs.
            if not url.startswith("https://") or len(url) > 300 or " " in url:
                raise ValueError("links must be https:// addresses")
            cleaned[key] = url
        return cleaned
