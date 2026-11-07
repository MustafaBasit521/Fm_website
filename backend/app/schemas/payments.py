"""Manual wallet payments (Easypaisa / JazzCash): what the customer submits and what the admin
sees. Customers never receive the admin's id."""

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import (
    OrderStatus,
    PaymentAttemptStatus,
    PaymentMethod,
    PaymentRejectionReason,
)

PAYMENT_PROOF_PATH = re.compile(r"^payment-proofs/[0-9a-f]{32}\.(jpg|png|webp)$")
REFERENCE = re.compile(r"^[A-Za-z0-9-]{6,40}$")


class PaymentSubmit(BaseModel):
    """What a customer sends after paying: the wallet's transaction number AND a screenshot of
    the receipt (already uploaded to the private bucket)."""

    model_config = ConfigDict(extra="forbid")

    reference: str = Field(max_length=100)
    image_path: str = Field(max_length=300)

    @field_validator("reference")
    @classmethod
    def _check_reference(cls, v: str) -> str:
        v = v.strip()
        if not REFERENCE.match(v):
            raise ValueError("the transaction number must be 6 to 40 letters, digits or dashes")
        return v

    @field_validator("image_path")
    @classmethod
    def _check_path(cls, v: str) -> str:
        if not PAYMENT_PROOF_PATH.match(v):
            raise ValueError("invalid image path")
        return v


class PaymentAttemptRead(BaseModel):
    """What the customer sees about one of their submissions."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    status: PaymentAttemptStatus
    transaction_reference: str
    amount_paisa: int
    created_at: datetime
    rejection_reason: PaymentRejectionReason | None = None
    rejection_note: str | None = None
    reviewed_at: datetime | None = None


class PaymentReject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: PaymentRejectionReason
    note: str | None = Field(default=None, max_length=300)

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: str | None) -> str | None:
        v = v.strip() if v else None
        return v or None

    @model_validator(mode="after")
    def _other_needs_a_note(self) -> "PaymentReject":
        if self.reason == PaymentRejectionReason.OTHER and not self.note:
            raise ValueError("please write the reason")
        return self


class AdminPaymentAttempt(PaymentAttemptRead):
    payment_id: uuid.UUID
    order_id: uuid.UUID
    order_status: OrderStatus
    method: PaymentMethod
    order_total_paisa: int
    customer_name: str
    customer_email: str
    customer_phone: str | None
    reviewed_by: uuid.UUID | None = None


class ReceiptLink(BaseModel):
    """A short-lived link to the customer's receipt screenshot."""

    url: str | None
