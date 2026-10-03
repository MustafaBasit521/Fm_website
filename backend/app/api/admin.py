from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.auth import AuthUser, require_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/me")
async def admin_me(user: Annotated[AuthUser, Depends(require_admin)]) -> dict[str, str]:
    """Lets the admin UI confirm the server recognises the admin role."""
    return {"id": str(user.id), "role": "admin"}
