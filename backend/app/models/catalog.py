import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Text,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, query_expression, relationship

from app.core.db import Base
from app.models.enums import ProductAvailability


class Category(Base):
    """database.md §6."""

    __tablename__ = "categories"

    category_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, unique=True)

    products: Mapped[list["Product"]] = relationship(back_populates="category")


class Product(Base):
    """database.md §7. Money is integer paisa."""

    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("price_paisa >= 0", name="ck_products_price_nonneg"),
        CheckConstraint("stock_quantity >= 0", name="ck_products_stock_nonneg"),
        CheckConstraint("max_active_units >= 0", name="ck_products_capacity_nonneg"),
        Index("ix_products_category_id", "category_id"),
        Index("ix_products_is_visible", "is_visible"),
        Index("ix_products_availability_type", "availability_type"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("categories.category_id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    price_paisa: Mapped[int] = mapped_column(BigInteger)
    availability_type: Mapped[ProductAvailability] = mapped_column(
        Enum(ProductAvailability, name="product_availability")
    )
    stock_quantity: Mapped[int] = mapped_column(Integer, server_default="0")
    max_active_units: Mapped[int] = mapped_column(Integer, server_default="0")
    is_visible: Mapped[bool] = mapped_column(Boolean, server_default=false())
    is_featured: Mapped[bool] = mapped_column(Boolean, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Units held by active orders. Not a column: load it with
    # `with_expression(Product.active_units, active_units_expr())` (see services/catalog.py).
    active_units: Mapped[int | None] = query_expression()

    category: Mapped[Category] = relationship(back_populates="products")
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product",
        order_by="ProductImage.sort_order, ProductImage.created_at",
        cascade="all, delete-orphan",
        passive_deletes=True,  # unloaded rows are removed by the DB's ON DELETE CASCADE
    )


class ProductImage(Base):
    """database.md §8. Files live in Supabase Storage; this row holds the path."""

    __tablename__ = "product_images"
    __table_args__ = (Index("ix_product_images_product_id", "product_id"),)

    image_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.product_id", ondelete="CASCADE")
    )
    storage_path: Mapped[str] = mapped_column(Text)
    alt_text: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    product: Mapped[Product] = relationship(back_populates="images")
