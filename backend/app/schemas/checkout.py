import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models.enums import OrderStatus, PaymentMethod, PaymentStatus
from app.schemas.address import AddressCreate
from app.schemas.catalog import ProductImageRead
from app.schemas.customer import CustomerUpdate

MAX_LINE_QUANTITY = 99
MAX_LINES = 50

LineIssue = Literal["NOT_FOUND", "UNAVAILABLE", "EXCEEDS_AVAILABLE"]


class CartLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    quantity: int = Field(ge=1, le=MAX_LINE_QUANTITY)


class QuoteRequest(BaseModel):
    """The browser cart: ids and quantities only. Prices are never accepted from the client."""

    model_config = ConfigDict(extra="forbid")

    items: list[CartLine] = Field(min_length=1, max_length=MAX_LINES)


class QuoteLine(BaseModel):
    product_id: uuid.UUID
    quantity: int
    name: str | None = None
    unit_price_paisa: int | None = None
    line_total_paisa: int | None = None
    image: ProductImageRead | None = None
    issue: LineIssue | None = None
    max_quantity: int | None = None  # set with EXCEEDS_AVAILABLE


class Quote(BaseModel):
    lines: list[QuoteLine]
    subtotal_paisa: int
    delivery_fee_paisa: int
    total_paisa: int
    payment_methods: list[PaymentMethod]
    can_checkout: bool


class Contact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return v.lower()

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        # Reuse the profile phone rules (blank clears, otherwise validated).
        return CustomerUpdate(phone=v).phone


class Delivery(BaseModel):
    """Exactly one of: a saved address (registered customers) or an inline address."""

    model_config = ConfigDict(extra="forbid")

    recipient_name: str | None = Field(default=None, max_length=100)
    address_id: uuid.UUID | None = None
    address: AddressCreate | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "Delivery":
        if (self.address_id is None) == (self.address is None):
            raise ValueError("provide exactly one of address_id or address")
        return self


class OrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[CartLine] = Field(min_length=1, max_length=MAX_LINES)
    contact: Contact
    delivery: Delivery
    payment_method: PaymentMethod
    # What the customer saw. If the real total differs the order is NOT created (409) so they
    # can review the new price. Optional: the server total is authoritative either way.
    expected_total_paisa: int | None = Field(default=None, ge=0)


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    product_id: uuid.UUID | None
    product_name_snapshot: str
    quantity: int
    unit_price_at_purchase_paisa: int


class OrderRead(BaseModel):
    order_id: uuid.UUID
    status: OrderStatus
    payment_method: PaymentMethod
    payment_status: PaymentStatus
    payment_deadline_at: datetime | None
    customer_name: str
    customer_email: str
    customer_phone: str | None
    delivery_name: str
    delivery_house_no: str
    delivery_street_number: str | None
    delivery_city: str
    delivery_province: str | None
    delivery_postal_code: str
    delivery_country: str
    items: list[OrderItemRead]
    subtotal_paisa: int
    delivery_fee_paisa: int
    total_amount_paisa: int
    created_at: datetime
    cancelled_at: datetime | None = None
    cancellation_charge_paisa: int = 0
    charge_waived: bool = False
    # Money still owed back to the customer for a cancelled, paid order. Actual refunds are
    # processed in the payments phase; this is the amount they will be.
    refund_due_paisa: int = 0
