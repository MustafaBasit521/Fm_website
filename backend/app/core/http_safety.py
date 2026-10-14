"""Cross-cutting HTTP safety: request ids and logging, a JSON 500 that never leaks internals,
security headers, and a coarse per-client request budget (CLAUDE.md §9, §17).

All pure ASGI middleware (no BaseHTTPMiddleware), so streaming and background work are untouched.
"""

import json
import logging
import time
import uuid

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings
from app.core.rate_limit import client_ip, limiter

logger = logging.getLogger("app.request")


def configure_logging(settings: Settings) -> None:
    """Make the app's own log lines visible under uvicorn (which configures only its own
    loggers). Safe to call repeatedly; does nothing if logging is already configured."""
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        root.addHandler(handler)
    logging.getLogger("app").setLevel(settings.log_level.upper())


class RequestContextMiddleware:
    """Gives every request an id (header `X-Request-ID`), logs one line per request, and turns an
    unexpected exception into a generic JSON 500 (the traceback goes to the log, with the id)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = uuid.uuid4().hex[:16]
        started = time.perf_counter()
        state = {"status": 500, "started": False}

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                state["status"], state["started"] = message["status"], True
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, wrapped)
        except Exception:
            logger.exception(
                "Unhandled error [request %s] %s %s", request_id, scope["method"], scope["path"]
            )
            if state["started"]:
                raise  # the response is already on its way; nothing safe to add
            body = json.dumps(
                {"detail": "Internal server error", "request_id": request_id}
            ).encode()
            state["status"] = 500
            await wrapped(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await wrapped({"type": "http.response.body", "body": body})
        finally:
            # Path only: query strings can hold search terms or tokens, and are never logged.
            logger.info(
                "request %s %s %s -> %s in %.0f ms",
                request_id,
                scope["method"],
                scope["path"],
                state["status"],
                (time.perf_counter() - started) * 1000,
            )


class SecurityHeadersMiddleware:
    """Headers every API response should carry. JSON responses are never meant to be rendered, so
    the policy is as strict as possible. Responses to authenticated or data-changing requests are
    marked uncacheable, so a shared cache can never keep one customer's data for another."""

    def __init__(self, app: ASGIApp, *, hsts: bool) -> None:
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        private = request.method != "GET" or "authorization" in request.headers

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                extra = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
                ]
                if private and b"cache-control" not in present:
                    extra.append((b"cache-control", b"no-store"))
                if self.hsts:
                    extra.append(
                        (b"strict-transport-security", b"max-age=31536000; includeSubDomains")
                    )
                headers.extend(h for h in extra if h[0] not in present)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, wrapped)


class GlobalRateLimitMiddleware:
    """A coarse per-client budget for the whole API, as a backstop behind the stricter per-route
    limits. Webhooks (called by the payment provider, signed) and health checks are exempt."""

    EXEMPT_PREFIXES = ("/api/payments/webhook", "/api/health")

    def __init__(self, app: ASGIApp, *, per_minute: int, trust_proxy_headers: bool) -> None:
        self.app = app
        self.per_minute = per_minute
        self.trust = trust_proxy_headers

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or self.per_minute <= 0
            or not path.startswith("/api")
            or scope["method"] == "OPTIONS"  # CORS preflight must always be answered
            or path.startswith(self.EXEMPT_PREFIXES)
        ):
            await self.app(scope, receive, send)
            return
        ip = client_ip(Request(scope), self.trust)
        retry_after = limiter.hit(f"global:{ip}", self.per_minute, 60)
        if retry_after is None:
            await self.app(scope, receive, send)
            return
        body = json.dumps({"detail": "Too many requests. Please try again later."}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 429,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"retry-after", str(retry_after).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
