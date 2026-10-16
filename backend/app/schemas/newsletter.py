from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class NewsletterSubscribe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


class NewsletterUnsubscribe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=10, max_length=100)
