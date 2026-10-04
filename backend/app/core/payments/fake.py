"""A fake payment gateway for development and tests. NEVER used in production
(Settings refuses PAYMENT_PROVIDER=fake when APP_ENV=production).

It behaves like a real gateway at the interface level: attempts have a reference, a status that
changes outside the app, verification by reference, signed webhooks (HMAC-SHA256), and refunds
with idempotency keys. State is kept in memory, so it is per-process and lost on restart.
"""

import hashlib
import hmac
import json
import uuid

from app.core.payments.base import (
    CheckoutSession,
    ProviderError,
    ProviderPayment,
    ProviderStatus,
    RefundResult,
    WebhookError,
    WebhookEvent,
)

SIGNATURE_HEADER = "x-fake-signature"


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class FakeProvider:
    name = "fake"

    def __init__(self, *, webhook_secret: str, frontend_url: str) -> None:
        self._secret = webhook_secret
        self._frontend_url = frontend_url
        self.attempts: dict[str, dict] = {}
        self.refunds: dict[str, RefundResult] = {}  # idempotency key -> result
        self.refunded: dict[str, int] = {}  # reference -> total refunded
        self.fail_refunds = False  # tests flip this to simulate a provider outage
        self.fail_verify = False

    # -- PaymentProvider -----------------------------------------------------------------

    async def create_checkout(
        self,
        *,
        order_id: uuid.UUID,
        payment_id: uuid.UUID,
        amount_paisa: int,
        customer_email: str,
        return_url: str,
    ) -> CheckoutSession:
        reference = f"fake_{uuid.uuid4().hex}"
        self.attempts[reference] = {
            "status": ProviderStatus.PENDING,
            "amount_paisa": amount_paisa,
            "order_id": str(order_id),
        }
        redirect = f"{self._frontend_url}/dev/fake-gateway?ref={reference}&order={order_id}"
        return CheckoutSession(reference=reference, redirect_url=redirect)

    async def verify(self, reference: str) -> ProviderPayment:
        if self.fail_verify:
            raise ProviderError("provider unreachable")
        attempt = self.attempts.get(reference)
        if attempt is None:
            raise ProviderError("unknown reference")
        return ProviderPayment(reference, attempt["status"], attempt["amount_paisa"])

    def parse_webhook(self, headers: dict[str, str], body: bytes) -> WebhookEvent:
        given = headers.get(SIGNATURE_HEADER, "")
        if not hmac.compare_digest(given, sign(self._secret, body)):
            raise WebhookError("bad signature")
        try:
            reference = json.loads(body)["reference"]
        except (ValueError, KeyError, TypeError):
            raise WebhookError("malformed body") from None
        if not isinstance(reference, str):
            raise WebhookError("malformed body")
        return WebhookEvent(reference=reference)

    async def refund(self, reference: str, amount_paisa: int, idempotency_key: str) -> RefundResult:
        if self.fail_refunds:
            raise ProviderError("provider unreachable")
        if idempotency_key in self.refunds:  # a retry of the same request: do not refund twice
            return self.refunds[idempotency_key]
        attempt = self.attempts.get(reference)
        if attempt is None or attempt["status"] != ProviderStatus.PAID:
            raise ProviderError("nothing to refund")
        already = self.refunded.get(reference, 0)
        if already + amount_paisa > attempt["amount_paisa"]:
            raise ProviderError("refund exceeds the payment")
        self.refunded[reference] = already + amount_paisa
        result = RefundResult(reference=f"refund_{uuid.uuid4().hex}")
        self.refunds[idempotency_key] = result
        return result

    # -- simulator controls (dev page / tests) -------------------------------------------

    def complete(self, reference: str, outcome: ProviderStatus) -> None:
        """Pretend the customer finished (or abandoned) paying at the gateway."""
        attempt = self.attempts.get(reference)
        if attempt is None:
            raise ProviderError("unknown reference")
        if attempt["status"] == ProviderStatus.PENDING:
            attempt["status"] = outcome

    def signed_webhook(self, reference: str) -> tuple[dict[str, str], bytes]:
        body = json.dumps({"reference": reference}).encode()
        return {SIGNATURE_HEADER: sign(self._secret, body)}, body
