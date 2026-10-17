import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import OrderStatus, PaymentMethod, PaymentStatus
from app.schemas.checkout import OrderRead


class OrderSummary(BaseModel):
    order_id: uuid.UUID
    status: OrderStatus
    payment_method: PaymentMethod
    payment_status: PaymentStatus
    total_amount_paisa: int
    item_count: int  # total units
    payment_deadline_at: datetime | None
    created_at: datetime
    image_urls: list[str] = []  # first pictures of the ordered products (customer list)


class AdminOrderSummary(OrderSummary):
    customer_name: str
    customer_email: str


class PaymentRead(BaseModel):
    """One payment attempt (online retries each have their own row)."""

    model_config = ConfigDict(from_attributes=True)

    payment_id: uuid.UUID
    method: PaymentMethod
    status: PaymentStatus
    amount_paisa: int
    refunded_amount_paisa: int
    provider_reference: str | None
    proof_reference: str | None = None
    proof_submitted_at: datetime | None = None
    created_at: datetime


class AdminOrderRead(OrderRead):
    customer_id: uuid.UUID | None
    updated_at: datetime
    payments: list[PaymentRead]


class InitiatePayment(BaseModel):
    payment_id: uuid.UUID
    redirect_url: str


class PaymentStatusRead(BaseModel):
    order_status: OrderStatus
    payment_status: PaymentStatus


class RefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Omit to refund everything that is still owed (paid - charge - already refunded).
    amount_paisa: int | None = Field(default=None, ge=1)


class StatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: OrderStatus


class AdminCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # business-rules §18: the admin may waive the Processing cancellation charge.
    waive_charge: bool = False


PAYMENT_PROOF_PATH = re.compile(r"^payment-proofs/[0-9a-f]{32}\.(jpg|png|webp)$")


class PaymentProofCreate(BaseModel):
    """What a customer sends after transferring money: a transaction number, a screenshot (already
    uploaded to the private bucket), or both."""

    model_config = ConfigDict(extra="forbid")

    reference: str | None = Field(default=None, max_length=100)
    image_path: str | None = Field(default=None, max_length=300)

    @field_validator("reference")
    @classmethod
    def _clean_reference(cls, v: str | None) -> str | None:
        v = v.strip() if v else None
        return v or None

    @field_validator("image_path")
    @classmethod
    def _check_path(cls, v: str | None) -> str | None:
        if v is not None and not PAYMENT_PROOF_PATH.match(v):
            raise ValueError("invalid image path")
        return v

    @model_validator(mode="after")
    def _something_is_needed(self) -> "PaymentProofCreate":
        if not self.reference and not self.image_path:
            raise ValueError("send a transaction number, a screenshot, or both")
        return self


class AdminProofImage(BaseModel):
    """A short-lived link to the customer's screenshot (None when they sent none)."""

    url: str | None
