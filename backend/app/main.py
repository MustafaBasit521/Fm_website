from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    addresses,
    admin,
    admin_catalog,
    admin_engagement,
    admin_orders,
    catalog,
    checkout,
    customers,
    engagement,
    health,
    orders,
    payments,
    wishlist,
)
from app.core.config import get_settings
from app.core.db import dispose_engine


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Crochet Shop API",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # auth uses Bearer JWT, not cookies
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(health.router, prefix="/api")
    app.include_router(customers.router, prefix="/api")
    app.include_router(addresses.router, prefix="/api")
    app.include_router(wishlist.router, prefix="/api")
    app.include_router(checkout.router, prefix="/api")
    app.include_router(orders.router, prefix="/api")
    app.include_router(payments.router, prefix="/api")
    for router in (
        engagement.notifications,
        engagement.reviews,
        engagement.gallery,
        engagement.custom_orders,
        engagement.contact,
        admin_engagement.reviews,
        admin_engagement.gallery,
        admin_engagement.custom_orders,
        admin_engagement.messages,
    ):
        app.include_router(router, prefix="/api")
    app.include_router(catalog.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")
    app.include_router(admin_catalog.router, prefix="/api")
    app.include_router(admin_orders.router, prefix="/api")
    if settings.payment_provider == "fake":  # dev-only simulator (refused in production)
        from app.api import dev_gateway

        app.include_router(dev_gateway.router, prefix="/api")
    return app


app = create_app()
