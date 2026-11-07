"""Admin dashboard, customers, categories overview and business settings, plus the public
settings read used by the storefront."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.storage import SupabaseStorage, get_storage, require_storage
from app.schemas.admin import (
    AdminCategory,
    AdminCustomer,
    AdminCustomerDetail,
    AdminSettingsRead,
    AuditEntry,
    DashboardSummary,
    SettingsRead,
    SettingsUpdate,
)
from app.schemas.catalog import Page
from app.schemas.engagement import IMAGE_TYPES, UploadRequest, UploadTarget
from app.services import admin as service
from app.services import catalog as catalog_service

Session = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[SupabaseStorage, Depends(get_storage)]
AppSettings = Annotated[Settings, Depends(get_settings)]
StorageRW = Annotated[SupabaseStorage, Depends(require_storage)]

admin = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _settings_read(row, storage: SupabaseStorage, settings: Settings) -> SettingsRead:
    def qr(path: str | None) -> str | None:
        return storage.public_url(path, storage.gallery_bucket) if path else None

    return SettingsRead(
        business_name=row.business_name,
        email=row.email,
        phone=row.phone,
        whatsapp=row.whatsapp,
        address=row.address,
        delivery_information=row.delivery_information,
        delivery_fee_paisa=row.delivery_fee_paisa,
        social_links=row.social_links or {},
        easypaisa_qr_url=qr(row.easypaisa_qr_path),
        easypaisa_details=row.easypaisa_details,
        jazzcash_qr_url=qr(row.jazzcash_qr_path),
        jazzcash_details=row.jazzcash_details,
        wallet_receipts_enabled=settings.manual_receipts_enabled,
    )


@admin.get("/dashboard", response_model=DashboardSummary)
async def dashboard(session: Session):
    return await service.dashboard(session)


@admin.get("/customers", response_model=Page[AdminCustomer])
async def list_customers(
    session: Session,
    search: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = await service.list_customers(
        session, search=search, page=page, page_size=page_size
    )
    return catalog_service.paginate(items, total, page, page_size)


@admin.get("/customers/{customer_id}", response_model=AdminCustomerDetail)
async def get_customer(customer_id: uuid.UUID, session: Session):
    return await service.get_customer(session, customer_id)


@admin.get("/categories", response_model=list[AdminCategory])
async def list_categories(session: Session):
    return await service.list_categories(session)


@admin.get("/audit-log", response_model=Page[AuditEntry])
async def audit_log(
    session: Session,
    user_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
):
    """Who changed what in the admin area (newest first)."""
    items, total = await service.list_audit_log(
        session, user_id=user_id, page=page, page_size=page_size
    )
    return catalog_service.paginate(items, total, page, page_size)


@admin.get("/settings", response_model=AdminSettingsRead)
async def get_settings_route(session: Session, storage: Storage, settings: AppSettings):
    row = await service.get_settings_row(session)
    return AdminSettingsRead(
        **_settings_read(row, storage, settings).model_dump(), updated_at=row.updated_at
    )


@admin.patch("/settings", response_model=AdminSettingsRead)
async def update_settings(
    data: SettingsUpdate, session: Session, storage: Storage, settings: AppSettings
):
    row = await service.update_settings(session, data)
    return AdminSettingsRead(
        **_settings_read(row, storage, settings).model_dump(), updated_at=row.updated_at
    )


@admin.post("/settings/payment-qr/upload-url", response_model=UploadTarget)
async def payment_qr_upload_url(data: UploadRequest, storage: StorageRW):
    """A signed upload URL for ONE wallet QR code. QR codes are meant to be shown to customers,
    so they live in the public gallery bucket under `payment-qr/`."""
    path = f"payment-qr/{uuid.uuid4().hex}.{IMAGE_TYPES[data.content_type]}"
    signed = await storage.create_signed_upload(path, storage.gallery_bucket)
    return UploadTarget(
        storage_path=signed.path,
        upload_url=signed.upload_url,
        token=signed.token,
        bucket=storage.gallery_bucket,
    )


public = APIRouter(tags=["settings"])


@public.get("/settings", response_model=SettingsRead)
async def public_settings(session: Session, storage: Storage, settings: AppSettings):
    """Shop contact details and delivery fee for the storefront (all of it is public by nature)."""
    return _settings_read(await service.get_settings_row(session), storage, settings)
