import uuid

from pydantic import BaseModel, ConfigDict


class WishlistAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
