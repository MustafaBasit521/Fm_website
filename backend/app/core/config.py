from functools import lru_cache
from typing import Annotated

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    database_url: str
    # Supabase project URL, e.g. https://<ref>.supabase.co (public value, not a secret)
    supabase_url: str
    # SERVER-ONLY secret (Supabase "secret"/service-role key). Used solely to mint signed
    # Storage upload URLs and delete Storage files. Never sent to the browser.
    supabase_service_key: SecretStr | None = None
    product_images_bucket: str = "product-images"
    gallery_images_bucket: str = "gallery-images"  # public
    custom_order_references_bucket: str = "custom-order-references"  # PRIVATE
    # Online payment needs a gateway (chosen/implemented in the payments phase). Until then the
    # API refuses ONLINE orders so nobody places an order they cannot pay for.
    online_payments_enabled: bool = False
    # "none" = no gateway configured. "fake" is a development simulator and is refused in
    # production. A real gateway adapter is added once one is chosen (CLAUDE.md §3).
    payment_provider: str = "none"
    # Shared secret used to verify webhook signatures (server-only).
    payment_webhook_secret: SecretStr | None = None
    # Where the browser returns after paying (the storefront origin).
    frontend_url: str = "http://localhost:5173"
    # "none" = emails are not sent. "console" only logs them (development; refused in production).
    # "resend" sends through Resend (https://resend.com): needs RESEND_API_KEY and EMAIL_FROM.
    email_provider: str = "none"
    # Server-only secret. Never commit it and never send it to the browser.
    resend_api_key: SecretStr | None = None
    # The sender shown to customers, e.g. "Bundle of Loops <hello@yourdomain.com>". Resend only
    # delivers to anyone once the domain is verified there (until then: "onboarding@resend.dev"
    # may send only to the account owner's own address, which is enough for testing).
    email_from: str | None = None
    # Behind a reverse proxy (Vercel, nginx, ...) the client IP is in X-Forwarded-For. Enable only
    # when the app is really behind such a proxy, otherwise clients could spoof their IP.
    trust_proxy_headers: bool = False
    # The shop and the admin are separate sites (separate origins), so both are allowed here.
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://localhost:5174",
    ]
    # Every /api/admin/* call (except the identity check) needs a login that completed a second
    # factor (Supabase aal2). Production refuses to turn this off.
    admin_require_mfa: bool = True
    # Backstop for the whole API: requests per client per minute (0 turns it off).
    global_rate_limit_per_minute: int = 600
    log_level: str = "INFO"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("database_url")
    @classmethod
    def _require_asyncpg(cls, v: str) -> str:
        if not v.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must use the postgresql+asyncpg:// scheme")
        return v

    @field_validator("supabase_url")
    @classmethod
    def _normalize_supabase_url(cls, v: str) -> str:
        return v.rstrip("/")

    @field_validator("frontend_url")
    @classmethod
    def _normalize_frontend_url(cls, v: str) -> str:
        return v.rstrip("/")

    @model_validator(mode="after")
    def _check_payment_settings(self) -> "Settings":
        if self.payment_provider not in ("none", "fake"):
            raise ValueError("PAYMENT_PROVIDER must be 'none' or 'fake' until a gateway is added")
        if self.payment_provider == "fake" and self.is_production:
            raise ValueError("The fake payment provider cannot be used in production")
        if self.log_level.upper() not in ("DEBUG", "INFO", "WARNING", "ERROR"):
            raise ValueError("LOG_LEVEL must be DEBUG, INFO, WARNING or ERROR")
        if self.is_production and not self.admin_require_mfa:
            raise ValueError("ADMIN_REQUIRE_MFA cannot be turned off in production")
        if self.email_provider not in ("none", "console", "resend"):
            raise ValueError("EMAIL_PROVIDER must be 'none', 'console' or 'resend'")
        if self.email_provider == "resend" and not (self.resend_api_key and self.email_from):
            raise ValueError("EMAIL_PROVIDER=resend requires RESEND_API_KEY and EMAIL_FROM")
        if self.email_provider == "console" and self.is_production:
            raise ValueError("The console email provider cannot be used in production")
        if self.online_payments_enabled and self.payment_provider == "none":
            raise ValueError("ONLINE_PAYMENTS_ENABLED requires a PAYMENT_PROVIDER")
        return self

    @property
    def jwt_issuer(self) -> str:
        return f"{self.supabase_url}/auth/v1"

    @property
    def jwks_url(self) -> str:
        return f"{self.jwt_issuer}/.well-known/jwks.json"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
