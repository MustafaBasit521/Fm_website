import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

_PHONE_RE = re.compile(r"^\+?[0-9 ()-]{7,20}$")


class CustomerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    customer_id: uuid.UUID
    name: str
    email: EmailStr
    phone: str | None
    subscribed_to_updates: bool
    created_at: datetime


class CustomerUpdate(BaseModel):
    """Self-service profile edit. Email and id are deliberately not editable here."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=20)
    subscribed_to_updates: bool | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None  # empty string clears the phone number
        v = v.strip()
        if not _PHONE_RE.match(v):
            raise ValueError("invalid phone number")
        return v
