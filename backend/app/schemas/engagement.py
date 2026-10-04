import re
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.models.enums import (
    CustomOrderStatus,
    GalleryImageType,
    MessageStatus,
    NotificationStatus,
    NotificationType,
)
from app.schemas.customer import CustomerUpdate

IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_BUDGET_PAISA = 100_000_000  # Rs 1,000,000: a sanity cap against typos


def _text(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be blank")
    return v


def _optional_text(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


def _required_phone(v: str) -> str:
    cleaned = CustomerUpdate(phone=v).phone  # same phone rules as the profile
    if cleaned is None:
        raise ValueError("must not be blank")
    return cleaned


# ---- notifications -------------------------------------------------------------------------


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    notification_id: uuid.UUID
    type: NotificationType
    title: str
    message: str
    status: NotificationStatus
    created_at: datetime


class UnreadCount(BaseModel):
    unread: int


# ---- reviews -------------------------------------------------------------------------------


class ReviewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)

    _clean = field_validator("comment")(_optional_text)


class ReviewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: int | None = Field(default=None, ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)

    _clean = field_validator("comment")(_optional_text)

    @model_validator(mode="after")
    def _something_to_change(self) -> "ReviewUpdate":
        if not self.model_fields_set:
            raise ValueError("provide rating and/or comment")
        if "rating" in self.model_fields_set and self.rating is None:
            raise ValueError("rating cannot be null")
        return self


class ReviewRead(BaseModel):
    review_id: uuid.UUID
    product_id: uuid.UUID | None
    rating: int
    comment: str | None
    author: str  # first name only, for privacy
    created_at: datetime


class ReviewList(BaseModel):
    items: list[ReviewRead]
    total: int
    page: int
    page_size: int
    average_rating: float | None
    rating_count: int


class MyReviewState(BaseModel):
    eligible: bool  # has a Delivered order containing this product
    review: ReviewRead | None


class AdminReviewRead(ReviewRead):
    customer_id: uuid.UUID | None
    customer_name: str | None
    order_id: uuid.UUID
    product_name_snapshot: str


# ---- gallery -------------------------------------------------------------------------------


class UploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_type: Literal["image/jpeg", "image/png", "image/webp"]


class UploadTarget(BaseModel):
    storage_path: str
    upload_url: str
    token: str
    bucket: str


class GalleryImageRead(BaseModel):
    gallery_image_id: uuid.UUID
    url: str
    title: str | None
    description: str | None
    image_type: GalleryImageType


class AdminGalleryImage(GalleryImageRead):
    is_visible: bool
    created_at: datetime


class GalleryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    storage_path: str = Field(max_length=300)
    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    image_type: GalleryImageType
    is_visible: bool = False  # like products: hidden until the admin publishes it

    _clean = field_validator("title", "description")(_optional_text)


class GalleryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    image_type: GalleryImageType | None = None
    is_visible: bool | None = None

    _clean = field_validator("title", "description")(_optional_text)


GALLERY_PATH = re.compile(r"^gallery/[0-9a-f]{32}\.(jpg|png|webp)$")
CUSTOM_ORDER_PATH = re.compile(r"^custom-orders/[0-9a-f]{32}\.(jpg|png|webp)$")


# ---- custom orders -------------------------------------------------------------------------


class CustomOrderCreate(BaseModel):
    """business-rules §29. Guests may submit (no login needed)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    whatsapp_number: str = Field(min_length=1, max_length=20)
    description: str = Field(min_length=1, max_length=3000)
    budget_paisa: int | None = Field(default=None, ge=0, le=MAX_BUDGET_PAISA)
    required_date: date | None = None
    reference_image_path: str | None = Field(default=None, max_length=300)

    _name = field_validator("name", "description")(_text)
    _phone = field_validator("whatsapp_number")(_required_phone)

    @field_validator("required_date")
    @classmethod
    def _not_in_the_past(cls, v: date | None) -> date | None:
        if v is not None and v < date.today():
            raise ValueError("required date cannot be in the past")
        return v

    @field_validator("reference_image_path")
    @classmethod
    def _valid_path(cls, v: str | None) -> str | None:
        if v is not None and not CUSTOM_ORDER_PATH.match(v):
            raise ValueError("invalid reference image path")
        return v


class CustomOrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    custom_order_id: uuid.UUID
    name: str
    whatsapp_number: str
    description: str
    budget_paisa: int | None
    required_date: date | None
    status: CustomOrderStatus
    has_reference_image: bool
    created_at: datetime
    updated_at: datetime


class AdminCustomOrderRead(CustomOrderRead):
    customer_id: uuid.UUID | None
    # A short-lived signed link to the private reference image (None when there is none).
    reference_image_url: str | None


class CustomOrderStatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: CustomOrderStatus


# ---- contact messages ----------------------------------------------------------------------


class ContactCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)
    whatsapp_number: str | None = Field(default=None, max_length=20)
    message: str = Field(min_length=1, max_length=3000)

    _name = field_validator("name", "message")(_text)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return v.lower() if v else None

    @field_validator("phone", "whatsapp_number")
    @classmethod
    def _phones(cls, v: str | None) -> str | None:
        return CustomerUpdate(phone=v).phone if v is not None else None

    @model_validator(mode="after")
    def _a_way_to_reply(self) -> "ContactCreate":
        if not (self.email or self.phone or self.whatsapp_number):
            raise ValueError("give an email, phone or WhatsApp number so we can reply")
        return self


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    message_id: uuid.UUID
    name: str
    email: str | None
    phone: str | None
    whatsapp_number: str | None
    message: str
    status: MessageStatus
    created_at: datetime


class MessageStatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: MessageStatus
