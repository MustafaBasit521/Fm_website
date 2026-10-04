import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

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


class AdminOrderRead(OrderRead):
    customer_id: uuid.UUID | None
    updated_at: datetime


class StatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: OrderStatus


class AdminCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # business-rules §18: the admin may waive the Processing cancellation charge.
    waive_charge: bool = False
