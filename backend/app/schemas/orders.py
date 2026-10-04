import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

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
