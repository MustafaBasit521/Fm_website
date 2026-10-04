# Import every model module here so Alembic autogenerate and Base.metadata see them.
from app.models.catalog import Category, Product, ProductImage
from app.models.customer import Customer
from app.models.customer_data import Address, WishlistItem

__all__ = ["Address", "Category", "Customer", "Product", "ProductImage", "WishlistItem"]
