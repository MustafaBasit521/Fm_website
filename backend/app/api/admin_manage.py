"""Admin dashboard, customers, categories overview and business settings, plus the public
settings read used by the storefront."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_session
from app.schemas.admin import (
    AdminCategory,
    AdminCustomer,
    AdminCustomerDetail,
    AdminSettingsRead,
    DashboardSummary,
    SettingsRead,
    SettingsUpdate,
)
from app.schemas.catalog import Page
from app.services import admin as service
from app.services import catalog as catalog_service

Session = Annotated[AsyncSession, Depends(get_session)]

admin = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _settings_read(row) -> SettingsRead:
    return SettingsRead(
        business_name=row.business_name,
        email=row.email,
        phone=row.phone,
        whatsapp=row.whatsapp,
        address=row.address,
        delivery_information=row.delivery_information,
        delivery_fee_paisa=row.delivery_fee_paisa,
        social_links=row.social_links or {},
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


@admin.get("/settings", response_model=AdminSettingsRead)
async def get_settings(session: Session):
    row = await service.get_settings_row(session)
    return AdminSettingsRead(**_settings_read(row).model_dump(), updated_at=row.updated_at)


@admin.patch("/settings", response_model=AdminSettingsRead)
async def update_settings(data: SettingsUpdate, session: Session):
    row = await service.update_settings(session, data)
    return AdminSettingsRead(**_settings_read(row).model_dump(), updated_at=row.updated_at)


public = APIRouter(tags=["settings"])


@public.get("/settings", response_model=SettingsRead)
async def public_settings(session: Session):
    """Shop contact details and delivery fee for the storefront (all of it is public by nature)."""
    return _settings_read(await service.get_settings_row(session))
