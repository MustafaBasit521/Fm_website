"""Supabase Storage access for product images (CLAUDE.md §10).

FastAPI never streams image bytes. It authorizes the admin, mints a short-lived signed upload
URL, and the browser uploads straight to Storage. Allowed MIME types and the maximum file
size are enforced by the bucket's own rules (configured in Supabase), not by us.
"""

import logging
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, status

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SignedUpload:
    path: str
    token: str
    upload_url: str


class StorageNotConfiguredError(Exception):
    pass


class SupabaseStorage:
    """Talks to Supabase Storage with the server-only service key. Each call names the bucket
    (default: product images). Gallery images are public; custom-order references are PRIVATE and
    are read only through short-lived signed URLs."""

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._transport = transport  # tests inject a mock transport; None = real network
        self._base = f"{settings.supabase_url}/storage/v1"
        self._bucket = settings.product_images_bucket
        self.gallery_bucket = settings.gallery_images_bucket
        self.custom_orders_bucket = settings.custom_order_references_bucket
        self._key = (
            settings.supabase_service_key.get_secret_value()
            if settings.supabase_service_key
            else None
        )

    def _headers(self) -> dict[str, str]:
        if not self._key:
            raise StorageNotConfiguredError
        return {"apikey": self._key, "Authorization": f"Bearer {self._key}"}

    @property
    def bucket(self) -> str:
        """The product-images bucket (kept for existing callers)."""
        return self._bucket

    def public_url(self, path: str, bucket: str | None = None) -> str:
        return f"{self._base}/object/public/{bucket or self._bucket}/{path}"

    async def create_signed_upload(self, path: str, bucket: str | None = None) -> SignedUpload:
        bucket = bucket or self._bucket
        headers = self._headers()
        async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
            res = await client.post(
                f"{self._base}/object/upload/sign/{bucket}/{path}", headers=headers
            )
        res.raise_for_status()
        body = res.json()
        token = body["token"] if "token" in body else body["url"].split("token=")[-1]
        return SignedUpload(
            path=path,
            token=token,
            upload_url=f"{self._base}/object/upload/sign/{bucket}/{path}?token={token}",
        )

    async def create_signed_download(self, path: str, bucket: str, expires_in: int = 3600) -> str:
        """A temporary URL for a file in a private bucket."""
        headers = self._headers()
        async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
            res = await client.post(
                f"{self._base}/object/sign/{bucket}/{path}",
                headers=headers,
                json={"expiresIn": expires_in},
            )
        res.raise_for_status()
        signed = res.json()["signedURL"]
        return f"{self._base}{signed}" if signed.startswith("/") else signed

    async def delete(self, paths: list[str], bucket: str | None = None) -> None:
        """Best effort: a failure leaves an orphan file, never a broken product row."""
        if not paths:
            return
        try:
            async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
                res = await client.request(
                    "DELETE",
                    f"{self._base}/object/{bucket or self._bucket}",
                    headers=self._headers(),
                    json={"prefixes": paths},
                )
            res.raise_for_status()
        except Exception:
            logger.exception("Failed to delete %d storage object(s): %s", len(paths), paths)


def get_storage(settings: Annotated[Settings, Depends(get_settings)]) -> SupabaseStorage:
    return SupabaseStorage(settings)


def require_storage(
    storage: Annotated[SupabaseStorage, Depends(get_storage)],
) -> SupabaseStorage:
    try:
        storage._headers()
    except StorageNotConfiguredError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Image storage is not configured"
        ) from None
    return storage
