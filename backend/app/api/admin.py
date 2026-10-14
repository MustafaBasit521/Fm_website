from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.auth import AuthUser, get_admin_user
from app.core.config import Settings, get_settings

# Only the admin role is checked here (not the second factor) so the admin site can find out
# whether the user still has to complete MFA. Every other /api/admin/* route requires it.
router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/me")
async def admin_me(
    user: Annotated[AuthUser, Depends(get_admin_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str | bool]:
    """Who the server believes this admin is, and whether the second factor is done."""
    return {
        "id": str(user.id),
        "role": "admin",
        "mfa_required": settings.admin_require_mfa,
        "mfa_verified": user.aal == "aal2",
    }
