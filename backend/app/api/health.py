from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness: the process is up. Does not touch the database."""
    return {"status": "ok"}


@router.get("/health/db")
async def health_db(
    response: Response, session: Annotated[AsyncSession, Depends(get_session)]
) -> dict[str, str]:
    """Readiness: the database is reachable. No error details are exposed."""
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unavailable"}
    return {"status": "ok"}
