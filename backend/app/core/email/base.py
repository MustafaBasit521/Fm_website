"""Email provider interface. The email service is not chosen yet (CLAUDE.md §3), so everything
is written against this interface; a real adapter implements `send` once one is chosen."""

from dataclasses import dataclass
from typing import Protocol


class EmailError(Exception):
    """The provider rejected or could not deliver a message."""


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    body: str  # plain text


class EmailProvider(Protocol):
    name: str

    async def send(self, message: EmailMessage) -> None: ...
