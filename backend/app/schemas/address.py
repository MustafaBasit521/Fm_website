import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_ADDRESSES_PER_CUSTOMER = 20  # technical abuse guard, not a business rule


def _optional(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None  # blank optional fields are stored as NULL


def _required(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be blank")
    return v


class AddressRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    address_id: uuid.UUID
    label: str | None
    house_no: str
    street_number: str | None
    city: str
    province: str | None
    postal_code: str
    country: str
    created_at: datetime


class AddressCreate(BaseModel):
    """business-rules §9. Required: house number, city, postal code, country."""

    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=50)
    house_no: str = Field(min_length=1, max_length=100)
    street_number: str | None = Field(default=None, max_length=100)
    city: str = Field(min_length=1, max_length=100)
    province: str | None = Field(default=None, max_length=100)
    postal_code: str = Field(min_length=1, max_length=20)
    country: str = Field(min_length=1, max_length=100)

    _req = field_validator("house_no", "city", "postal_code", "country")(_required)
    _opt = field_validator("label", "street_number", "province")(_optional)


class AddressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=50)
    house_no: str | None = Field(default=None, min_length=1, max_length=100)
    street_number: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, min_length=1, max_length=100)
    province: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, min_length=1, max_length=20)
    country: str | None = Field(default=None, min_length=1, max_length=100)

    _opt = field_validator("label", "street_number", "province")(_optional)

    @field_validator("house_no", "city", "postal_code", "country")
    @classmethod
    def _req(cls, v: str | None) -> str | None:
        return None if v is None else _required(v)
