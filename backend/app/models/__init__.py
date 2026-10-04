# Import every model module here so Alembic autogenerate and Base.metadata see them.
from app.models.business_settings import BusinessSettings
from app.models.catalog import Category, Product, ProductImage
from app.models.customer import Customer
from app.models.customer_data import Address, WishlistItem
from app.models.orders import Order, OrderItem, Payment

__all__ = [
    "Address",
    "BusinessSettings",
    "Category",
    "Customer",
    "Order",
    "OrderItem",
    "Payment",
    "Product",
    "ProductImage",
    "WishlistItem",
]
