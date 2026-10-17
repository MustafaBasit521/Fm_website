"""Checks the real services the app depends on, using the settings in `backend/.env`.

    cd backend && python -m app.tools.check_services              # read-only checks
    cd backend && python -m app.tools.check_services --send-test you@example.com

Nothing secret is ever printed. The read-only checks change nothing. `--send-test` sends one real
test email through the configured email provider (so it is opt-in)."""

import argparse
import asyncio
import sys
from dataclasses import dataclass

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings, get_settings
from app.core.email.base import EmailMessage
from app.core.email.providers import build_email_provider

MB5 = 5 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
PASS, FAIL, WARN, SKIP, MANUAL = "PASS", "FAIL", "WARN", "SKIP", "MANUAL"


@dataclass(frozen=True)
class Result:
    status: str
    name: str
    detail: str = ""


def _bucket_rules(name: str, want_public: bool, bucket: dict | None) -> list[Result]:
    if bucket is None:
        return [Result(FAIL, f"storage bucket '{name}'", "does not exist: create it in Supabase")]
    out = []
    public = bool(bucket.get("public"))
    if public != want_public:
        out.append(
            Result(
                FAIL,
                f"storage bucket '{name}' visibility",
                f"is {'public' if public else 'PRIVATE'}, "
                f"must be {'public' if want_public else 'PRIVATE'}",
            )
        )
    else:
        out.append(Result(PASS, f"storage bucket '{name}'", "public" if public else "private"))
    limit = bucket.get("file_size_limit")
    if limit is None or limit > MB5:
        out.append(
            Result(
                WARN, f"bucket '{name}' size limit", "set it to 5 MB (it is the only enforcement)"
            )
        )
    types = set(bucket.get("allowed_mime_types") or [])
    if not types or not types <= IMAGE_TYPES:
        out.append(
            Result(
                WARN,
                f"bucket '{name}' allowed types",
                "restrict to image/jpeg, image/png and image/webp (the only enforcement)",
            )
        )
    return out


async def check_storage(
    settings: Settings, transport: httpx.AsyncBaseTransport | None = None
) -> list[Result]:
    if not settings.supabase_service_key:
        return [Result(FAIL, "storage", "SUPABASE_SERVICE_KEY is not set: uploads cannot work")]
    key = settings.supabase_service_key.get_secret_value()
    try:
        async with httpx.AsyncClient(timeout=15, transport=transport) as client:
            res = await client.get(
                f"{settings.supabase_url}/storage/v1/bucket",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
            )
    except httpx.HTTPError as e:
        return [Result(FAIL, "storage", f"Supabase could not be reached ({type(e).__name__})")]
    if res.status_code != 200:
        return [Result(FAIL, "storage", f"Supabase answered {res.status_code}: check the key")]
    buckets = {b["name"]: b for b in res.json()}
    out = []
    for name, public in (
        (settings.product_images_bucket, True),
        (settings.gallery_images_bucket, True),
        (settings.custom_order_references_bucket, False),
    ):
        out += _bucket_rules(name, public, buckets.get(name))
    return out


async def check_auth(
    settings: Settings, transport: httpx.AsyncBaseTransport | None = None
) -> list[Result]:
    try:
        async with httpx.AsyncClient(timeout=15, transport=transport) as client:
            res = await client.get(settings.jwks_url)
        keys = res.json().get("keys", []) if res.status_code == 200 else []
    except (httpx.HTTPError, ValueError) as e:
        return [
            Result(FAIL, "supabase auth", f"signing keys could not be read ({type(e).__name__})")
        ]
    if not keys:
        return [Result(FAIL, "supabase auth", "no signing keys found: is SUPABASE_URL right?")]
    out = [Result(PASS, "supabase auth", f"{len(keys)} signing key(s) published")]
    out.append(
        Result(PASS, "admin two-factor", "required by the API (ADMIN_REQUIRE_MFA)")
        if settings.admin_require_mfa
        else Result(WARN, "admin two-factor", "ADMIN_REQUIRE_MFA is off: local development only")
    )
    out.append(
        Result(
            MANUAL,
            "authenticator codes (TOTP)",
            "Supabase dashboard > Authentication > Multi-Factor: TOTP must be enabled",
        )
    )
    return out


async def check_database(settings: Settings) -> list[Result]:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    engine = create_async_engine(settings.database_url)
    out: list[Result] = []
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            current = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar()
            head = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
            out.append(Result(PASS, "database", "connected"))
            out.append(
                Result(PASS, "migrations", f"up to date ({current})")
                if current == head
                else Result(
                    FAIL, "migrations", f"at {current}, latest is {head}: run alembic upgrade head"
                )
            )
            try:
                job = (
                    await conn.execute(
                        text(
                            "SELECT schedule, active FROM cron.job "
                            "WHERE jobname = 'expire-unpaid-online-orders'"
                        )
                    )
                ).first()
            except Exception:
                job = "missing-extension"
            if job == "missing-extension":
                out.append(
                    Result(
                        WARN,
                        "expiry job (pg_cron)",
                        "pg_cron is not enabled: see README (needed once online payment is on)",
                    )
                )
            elif job is None:
                out.append(
                    Result(
                        WARN,
                        "expiry job (pg_cron)",
                        "job 'expire-unpaid-online-orders' is not scheduled: see README",
                    )
                )
            else:
                out.append(
                    Result(
                        PASS if job.active else WARN,
                        "expiry job (pg_cron)",
                        f"schedule {job.schedule}",
                    )
                )
    except Exception as e:
        out.append(Result(FAIL, "database", f"could not connect ({type(e).__name__})"))
    finally:
        await engine.dispose()
    return out


async def check_email(settings: Settings, send_test_to: str | None) -> list[Result]:
    provider = settings.email_provider
    if provider == "none":
        return [Result(SKIP, "email", "EMAIL_PROVIDER=none: nothing is sent (set it to resend)")]
    out = [Result(PASS, "email provider", provider)]
    if provider == "resend":
        out.append(Result(MANUAL, "email domain", "Resend dashboard > Domains must show Verified"))
    if send_test_to is None:
        out.append(Result(SKIP, "test email", "add --send-test you@example.com to send one"))
        return out
    try:
        await build_email_provider(settings).send(
            EmailMessage(
                to=send_test_to,
                subject="Test email from your shop",
                body="If you can read this, email sending works.",
            )
        )
        out.append(Result(PASS, "test email", f"accepted for {send_test_to}: now check the inbox"))
    except Exception as e:
        out.append(Result(FAIL, "test email", str(e)[:300]))
    return out


async def run(send_test_to: str | None) -> list[Result]:
    settings = get_settings()
    results = [Result(PASS, "settings", f"APP_ENV={settings.app_env}")]
    results += await check_database(settings)
    results += await check_auth(settings)
    results += await check_storage(settings)
    results += await check_email(settings, send_test_to)
    results.append(
        Result(SKIP, "online payment", "no gateway chosen yet (PAYMENT_PROVIDER=none)")
        if settings.payment_provider == "none"
        else Result(PASS, "online payment", f"provider {settings.payment_provider}")
    )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--send-test", metavar="EMAIL", help="send one real test email")
    args = parser.parse_args()
    if args.send_test is not None and "@" not in args.send_test:
        parser.error("--send-test needs a real email address")
    results = asyncio.run(run(args.send_test))
    for r in results:
        print(f"[{r.status:6}] {r.name}" + (f" - {r.detail}" if r.detail else ""))
    failed = sum(r.status == FAIL for r in results)
    warned = sum(r.status == WARN for r in results)
    by_hand = sum(r.status == MANUAL for r in results)
    print(f"\n{failed} failed, {warned} warning(s), {by_hand} to check by hand")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
