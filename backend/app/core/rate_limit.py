"""A small in-process rate limiter for abuse-prone public endpoints (CLAUDE.md §9).

It is deliberately simple (no Redis, CLAUDE.md §2): a sliding window per client IP kept in this
process's memory. With several workers each has its own counters, so the effective limit is
per worker. That is acceptable for the MVP; a shared store can replace `RateLimiter` later.
"""

import time
from collections import defaultdict, deque
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from app.core.config import Settings, get_settings


class RateLimiter:
    def __init__(self) -> None:
        self.enabled = True
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str, limit: int, window_seconds: int) -> int | None:
        """Record a request. Returns None if allowed, or seconds to wait if over the limit."""
        if not self.enabled:
            return None
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] >= window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            return max(1, int(window_seconds - (now - hits[0])) + 1)
        hits.append(now)
        if len(self._hits) > 10_000:  # bound memory: drop keys with no recent activity
            for k in [k for k, v in self._hits.items() if not v or now - v[-1] >= window_seconds]:
                self._hits.pop(k, None)
        return None

    def reset(self) -> None:
        self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request, trust_proxy_headers: bool) -> str:
    if trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def rate_limit(name: str, limit: int, window_seconds: int):
    """FastAPI dependency: at most `limit` requests per `window_seconds` per client IP."""

    async def dependency(
        request: Request, settings: Annotated[Settings, Depends(get_settings)]
    ) -> None:
        ip = client_ip(request, settings.trust_proxy_headers)
        retry_after = limiter.hit(f"{name}:{ip}", limit, window_seconds)
        if retry_after is not None:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many requests. Please try again later.",
                headers={"Retry-After": str(retry_after)},
            )

    return dependency
