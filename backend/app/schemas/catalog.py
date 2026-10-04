import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import ProductAvailability

MAX_PRICE_PAISA = 100_000_000  # Rs 1,000,000: a sanity cap against typos
ALLOWED_IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

SortKey = Literal["newest", "price_asc", "price_desc", "name"]


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int


# ---- public read models ------------------------------------------------------------------


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category_id: uuid.UUID
    name: str


class ProductImageRead(BaseModel):
    image_id: uuid.UUID
    url: str
    alt_text: str | None
    sort_order: int


class ProductSummary(BaseModel):
    product_id: uuid.UUID
    name: str
    price_paisa: int
    category: CategoryRead
    availability_type: ProductAvailability
    is_available: bool
    is_featured: bool
    image: ProductImageRead | None


class ProductDetail(ProductSummary):
    description: str | None
    images: list[ProductImageRead]


# ---- admin models ------------------------------------------------------------------------


class AdminProduct(ProductDetail):
    category_id: uuid.UUID
    stock_quantity: int
    max_active_units: int
    is_visible: bool
    created_at: datetime
    updated_at: datetime


def _clean(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be blank")
    return v


class CategoryWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)

    _strip = field_validator("name")(_clean)


class ProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    price_paisa: int = Field(ge=0, le=MAX_PRICE_PAISA)
    availability_type: ProductAvailability
    stock_quantity: int = Field(default=0, ge=0, le=1_000_000)
    max_active_units: int = Field(default=0, ge=0, le=1_000_000)
    is_visible: bool = False  # new products start hidden until the admin publishes them
    is_featured: bool = False

    _strip = field_validator("name")(_clean)


class ProductUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    price_paisa: int | None = Field(default=None, ge=0, le=MAX_PRICE_PAISA)
    availability_type: ProductAvailability | None = None
    stock_quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    max_active_units: int | None = Field(default=None, ge=0, le=1_000_000)
    is_visible: bool | None = None
    is_featured: bool | None = None

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return None if v is None else _clean(v)


class UploadUrlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_type: Literal["image/jpeg", "image/png", "image/webp"]


class UploadUrlResponse(BaseModel):
    storage_path: str
    upload_url: str
    token: str
    bucket: str


class ImageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    storage_path: str = Field(max_length=300)
    alt_text: str | None = Field(default=None, max_length=200)
    sort_order: int = Field(default=0, ge=0, le=1000)


class ImageUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    alt_text: str | None = Field(default=None, max_length=200)
    sort_order: int | None = Field(default=None, ge=0, le=1000)


def storage_path_pattern(product_id: uuid.UUID) -> re.Pattern[str]:
    return re.compile(rf"^products/{product_id}/[0-9a-f]{{32}}\.(jpg|png|webp)$")
