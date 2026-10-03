# Import every model module here so Alembic autogenerate and Base.metadata see them.
from app.models.customer import Customer

__all__ = ["Customer"]
