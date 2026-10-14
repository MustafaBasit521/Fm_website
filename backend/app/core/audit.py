"""Audit log of the admin boundary (database.md §28).

A pure ASGI middleware (not BaseHTTPMiddleware, so streaming and background work are untouched).
After an `/api/admin/*` request finishes it records WHO did WHAT and the outcome, but only for:

* requests that change data (POST/PATCH/PUT/DELETE) by an authenticated user, whatever the
  outcome (a refused or failed change is just as interesting as a successful one), and
* any authenticated request the server refused with 403 (a customer poking at admin routes, or
  an admin without the second factor).

Not logged: reads by the admin (they would drown the log) and unauthenticated requests (there is
no identity to record, and anyone on the internet could otherwise fill the table).
Request bodies are never stored, so no personal data or secrets end up in the log. A failure to
write the log is reported at ERROR level but never changes the response.
"""

import logging
import re

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.core.rate_limit import client_ip
from app.models.audit import AdminAuditLog

logger = logging.getLogger(__name__)

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def action_for(method: str, path: str) -> str:
    """'POST /api/admin/orders/{id}/cancel': ids masked so the same action groups together."""
    return f"{method} {_UUID.sub('{id}', path)}"


class AuditMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/admin"):
            await self.app(scope, receive, send)
            return

        outcome: dict[str, int] = {}

        async def capture(message: Message) -> None:
            if message["type"] == "http.response.start":
                outcome["status"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, capture)
        finally:
            await self._record(scope, outcome.get("status", 500))

    async def _record(self, scope: Scope, status_code: int) -> None:
        try:
            user = scope.get("state", {}).get("auth_user")
            if user is None:
                return
            method = scope["method"]
            if method not in _MUTATING and status_code != 403:
                return
            request = Request(scope)
            entry = AdminAuditLog(
                user_id=user.id,
                action=action_for(method, scope["path"]),
                path=scope["path"],
                status_code=status_code,
                ip=client_ip(request, get_settings().trust_proxy_headers),
            )
            maker: async_sessionmaker[AsyncSession] = (
                getattr(scope["app"].state, "audit_sessionmaker", None) or get_sessionmaker()
            )
            async with maker() as session:
                session.add(entry)
                await session.commit()
        except Exception:
            logger.exception("Could not write the admin audit log entry")
