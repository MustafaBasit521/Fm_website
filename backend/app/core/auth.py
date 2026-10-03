"""JWT verification and authentication/authorization dependencies.

Supabase Auth issues the tokens. We verify them locally against the project's public
signing keys (JWKS), so the backend holds no Supabase secret. Authorization decisions use
only server-controlled claims (`sub`, `app_metadata.role`), never `user_metadata`, which
users can edit themselves.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

# Supabase projects with asymmetric signing keys use ES256. Pinning the algorithm list
# prevents algorithm-confusion attacks (including "none" and HS256-with-public-key).
ALLOWED_ALGORITHMS = ["ES256"]
JWT_AUDIENCE = "authenticated"
ADMIN_ROLE = "admin"

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthUser:
    id: uuid.UUID
    email: str | None
    name: str | None  # from user_metadata: display data only, never used for authorization
    is_admin: bool


def _unauthorized() -> HTTPException:
    # One generic message for every failure: do not tell attackers why a token was rejected.
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


@lru_cache
def _jwks_client() -> PyJWKClient:
    # PyJWKClient caches fetched keys and refreshes when it sees an unknown `kid`.
    return PyJWKClient(get_settings().jwks_url, cache_keys=True, lifespan=3600, timeout=5)


async def get_signing_key(token: str) -> Any:
    """Resolve the public key for a token. Overridable in tests via FastAPI dependency."""
    # PyJWKClient does blocking HTTP, so keep it off the event loop.
    signing_key = await asyncio.to_thread(_jwks_client().get_signing_key_from_jwt, token)
    return signing_key.key


class KeyResolver:
    """Callable dependency wrapper so tests can swap the key source."""

    async def __call__(self, token: str) -> Any:
        return await get_signing_key(token)


def get_key_resolver() -> KeyResolver:
    return KeyResolver()


async def verify_token(token: str, settings: Settings, resolver: KeyResolver) -> AuthUser:
    try:
        key = await resolver(token)
        claims = jwt.decode(
            token,
            key,
            algorithms=ALLOWED_ALGORITHMS,
            audience=JWT_AUDIENCE,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
        user_id = uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise _unauthorized() from None
    except Exception:
        # e.g. JWKS endpoint unreachable. Fail closed, log for operators.
        logger.exception("Token verification failed unexpectedly")
        raise _unauthorized() from None

    app_meta = claims.get("app_metadata") or {}
    user_meta = claims.get("user_metadata") or {}
    email = claims.get("email")
    return AuthUser(
        id=user_id,
        email=email.lower() if isinstance(email, str) else None,
        name=user_meta.get("name") if isinstance(user_meta.get("name"), str) else None,
        is_admin=app_meta.get("role") == ADMIN_ROLE,
    )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
    resolver: Annotated[KeyResolver, Depends(get_key_resolver)],
) -> AuthUser:
    if credentials is None:
        raise _unauthorized()
    return await verify_token(credentials.credentials, settings, resolver)


async def require_admin(user: Annotated[AuthUser, Depends(get_current_user)]) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return user
