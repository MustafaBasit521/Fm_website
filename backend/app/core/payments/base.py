"""Payment provider interface.

The gateway is not chosen yet (CLAUDE.md §3), so everything that does not depend on a specific
gateway is written against this interface. A real adapter implements the same four calls. The
backend never trusts the browser or a webhook body for payment success: it always asks the
provider (`verify`) before changing any state (business-rules §21).
"""

import enum
import uuid
from dataclasses import dataclass
from typing import Protocol


class ProviderError(Exception):
    """The provider could not be reached or rejected a request (safe to retry later)."""


class WebhookError(Exception):
    """The webhook is not authentic or not understood (reject it, do not retry)."""


class ProviderStatus(enum.StrEnum):
    PENDING = "PENDING"  # session open, nothing paid yet
    PAID = "PAID"
    FAILED = "FAILED"  # declined, cancelled or expired at the provider


@dataclass(frozen=True)
class CheckoutSession:
    reference: str  # the provider's id for this attempt (stored in payments.provider_reference)
    redirect_url: str  # where to send the customer to pay


@dataclass(frozen=True)
class ProviderPayment:
    reference: str
    status: ProviderStatus
    amount_paisa: int  # what the provider says was charged


@dataclass(frozen=True)
class WebhookEvent:
    reference: str  # which attempt the notification is about (nothing else is trusted)


@dataclass(frozen=True)
class RefundResult:
    reference: str


class PaymentProvider(Protocol):
    name: str

    async def create_checkout(
        self,
        *,
        order_id: uuid.UUID,
        payment_id: uuid.UUID,
        amount_paisa: int,
        customer_email: str,
        return_url: str,
    ) -> CheckoutSession: ...

    async def verify(self, reference: str) -> ProviderPayment: ...

    def parse_webhook(self, headers: dict[str, str], body: bytes) -> WebhookEvent:
        """Authenticate the webhook (signature) and extract the attempt reference.
        Raises WebhookError when it cannot be trusted."""
        ...

    async def refund(
        self, reference: str, amount_paisa: int, idempotency_key: str
    ) -> RefundResult: ...
