# Crochet Shop

Modular-monolith e-commerce site. Project rules live in `CLAUDE.md` and `docs/`.

```
backend/    FastAPI + async SQLAlchemy + Alembic (Python 3.12)
frontend/   React + TypeScript + Vite + Tailwind
docs/       business-rules.md, database.md, progress.md
```

## First-time setup

```bash
# backend
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env
# frontend
cd ../frontend && npm install && cp .env.example .env
```

## Daily workflow

```bash
make db         # local Postgres (docker, port 5433) - dev only; real DB is Supabase
make migrate    # apply migrations
make backend    # http://localhost:8000  (docs at /docs in development)
make frontend   # SHOP site  http://localhost:5173  (proxies /api to the backend)
make admin      # ADMIN site http://localhost:5174  (a separate app and origin)
make check      # lint + tests + build
```

Secrets go in `.env` files only (git-ignored). Never put secrets in `VITE_*` variables.

## Creating the admin

The system has one admin (business-rules §32). The role is stored in the server-controlled
`app_metadata`, never in user-editable metadata. After that person has registered normally,
run this once in the Supabase SQL editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'
where email = 'admin@example.com';
```

They must log out and in again so the new token carries the role.

After that, run `make admin` and open **http://localhost:5174** (the admin site is a separate app on
its own port, and the shop has no link to it). The admin area covers the dashboard, orders
(including cancellation and refunds), products and pictures, categories, customers, gallery, custom
orders, messages, reviews, the activity log and the shop settings.

### Two-factor login (required for the admin)

The API refuses every admin request unless the login completed a second factor, so a stolen
password alone is useless. One-time setup:

1. Supabase dashboard → **Authentication → Multi-Factor** → make sure **TOTP (authenticator app)**
   is enabled.
2. Log in at http://localhost:5174. The first time, the site shows a QR code: scan it with an
   authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) and type the 6-digit
   code. After that, every login asks for the current code.

For quick local work only, `ADMIN_REQUIRE_MFA=false` in `backend/.env` skips the check (the app
refuses that setting in production). Also make sure `CORS_ORIGINS` in `backend/.env` lists **both**
`http://localhost:5173` and `http://localhost:5174`.

### Deploying the two sites

`cd frontend && npm run build` produces two independent static sites: `dist/shop` (host it on your
public domain, e.g. `www.yourshop.com`) and `dist/admin` (host it on its own domain, e.g.
`admin.yourshop.com`). Both call the same API, so list **both** origins in `CORS_ORIGINS`. Giving
the admin site its own domain means the shop can never read the admin's login session; you can also
put extra protection (IP allowlist or an access gateway) in front of the admin domain only.

## Storage buckets (one-time setup)

1. Supabase dashboard -> Storage -> New bucket: name `product-images`, **public**, file size limit
   5 MB, allowed MIME types `image/jpeg, image/png, image/webp` (the bucket enforces these).
2. Supabase dashboard -> Settings -> API Keys: copy the **secret** key into `backend/.env` as
   `SUPABASE_SERVICE_KEY`. It is server-only: never put it in a `VITE_*` variable or commit it.
   Without it, image upload endpoints return 503 and everything else still works.
3. Two more buckets for the engagement features: **`gallery-images`** (public, 5 MB limit, jpeg/png/webp) and
   **`custom-order-references`** (**private**, 5 MB limit, jpeg/png/webp). The private bucket must never be made
   public: customers' reference pictures are shown only to the admin through short-lived signed links.

## Automatic expiry of unpaid online orders (one-time setup on Supabase)

Online orders must be paid within 30 minutes (business-rules §13). The database function
`expire_unpaid_online_orders()` cancels expired ones and returns reserved stock. Schedule it
with pg_cron in the Supabase SQL editor (the extension is available but not enabled by default):

```sql
create extension if not exists pg_cron;
select cron.schedule('expire-unpaid-online-orders', '* * * * *',
                     $$select public.expire_unpaid_online_orders()$$);
-- check:   select jobid, schedule, command, active from cron.job;
-- remove:  select cron.unschedule('expire-unpaid-online-orders');
```

The API also runs the same function right before reserving stock for a new order, so orders stay
correct even without the schedule. Online payment itself is switched off
(`ONLINE_PAYMENTS_ENABLED=false`) until the payment phase.

## Delivery fee

Until the admin UI exists, change the fee (in paisa; Rs 200 = 20000) with:

```sql
update business_settings set delivery_fee_paisa = 20000;
```

## Trying online payment locally (fake gateway)

No real gateway is integrated yet. To try the whole online-payment flow on your machine, add this
to `backend/.env` and restart `make backend` (never use it in production: the app refuses
`PAYMENT_PROVIDER=fake` when `APP_ENV=production`):

```
ONLINE_PAYMENTS_ENABLED=true
PAYMENT_PROVIDER=fake
PAYMENT_WEBHOOK_SECRET=any-long-random-text-for-local-use
FRONTEND_URL=http://localhost:5173
```

Then check out choosing "Pay online". On the confirmation page click **Pay now**, and on the
fake gateway page choose **Pay successfully** or **Fail the payment**. After a failure you can
**Try paying again** within 30 minutes. Set the flag back to `false` and the provider to `none`
afterwards (the fake gateway keeps its state in memory only).

## Check the real services

One command tells you what is and is not set up (it prints no secrets and changes nothing):

```bash
cd backend && .venv/bin/python -m app.tools.check_services
# also send one real test email through the configured provider:
cd backend && .venv/bin/python -m app.tools.check_services --send-test you@example.com
```

It checks the database and migrations, the pg_cron expiry job, the Supabase signing keys, the three
Storage buckets (existence, public/private, 5 MB limit, image types), the admin two-factor setting
and the email provider. Lines marked `MANUAL` need a look in a dashboard (authenticator codes in
Supabase, the verified domain in Resend).

## Email (Resend)

By default no email is sent (`EMAIL_PROVIDER=none`). To see the emails the app would send, set
`EMAIL_PROVIDER=console` in `backend/.env` and watch the server log (development only; the app
refuses it in production).

**To send real emails with [Resend](https://resend.com):**

1. Create a Resend account and an API key (Resend dashboard -> API Keys).
2. In `backend/.env` set (the file is git-ignored; never paste the key anywhere else):

   ```text
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=re_...
   EMAIL_FROM=Bundle of Loops <hello@yourdomain.com>
   ```

3. **Testing:** with no domain yet, use `EMAIL_FROM=onboarding@resend.dev`. Resend then delivers
   only to the address of your own Resend account, which is enough to try the welcome email.
4. **Real customers:** add your own domain in Resend (Domains), add the DNS records it shows, wait
   for "Verified", then use an address on that domain in `EMAIL_FROM`.
5. In production set the same three variables in the host's environment settings. The app refuses
   to start with `EMAIL_PROVIDER=resend` if the key or the sender is missing.

Emails are sent after the database change is saved and never block or fail the request: if Resend
refuses one (unverified domain, bad address) the reason is written to the server log. The shop
alerts (new orders,
custom orders, messages) go to the email address in the business settings:

```sql
update business_settings set email = 'you@example.com';
```

If the app runs behind a reverse proxy, also set `TRUST_PROXY_HEADERS=true` so rate limiting sees
the real client address (leave it `false` otherwise).

## Going to production (checklist)

**Hosting layout.** Three things are deployed separately: the **shop site** (`deploy/shop`), the
**admin site** (`deploy/admin`) and the **API** (FastAPI, any host that runs Python 3.12). Both
sites are static builds. On Vercel, create two projects from this repository and set each project's
*Root Directory* to `deploy/shop` or `deploy/admin`; each folder contains a `vercel.json` with the
build command, single-page-app rewrite and the browser security headers (content security policy,
no framing, no sniffing, HTTPS-only, and `noindex` for the admin). **Before deploying, replace
`API_DOMAIN` in both `vercel.json` files with your API's domain** (it is the only network address
the sites are allowed to call besides Supabase). Choose the domains later; nothing in the code
depends on them.

**API environment (`backend/.env` on the host, never in the repository):**

| Setting | Production value |
|---|---|
| `APP_ENV` | `production` (hides the API docs, turns on HSTS, forces two-factor login on) |
| `DATABASE_URL` | the Supabase *session pooler* string, with `postgresql+asyncpg://` |
| `SUPABASE_URL` | your project URL |
| `SUPABASE_SERVICE_KEY` | the secret key (server only) |
| `CORS_ORIGINS` | exactly your two site origins, e.g. `https://www.yourshop.com,https://admin.yourshop.com` |
| `TRUST_PROXY_HEADERS` | `true` only if a trusted reverse proxy sets `X-Forwarded-For` (otherwise every visitor shares one rate-limit budget; the API logs a warning in production when this is off) |
| `PAYMENT_PROVIDER`, `ONLINE_PAYMENTS_ENABLED` | `none` / `false` until a real gateway adapter exists (the fake gateway is refused in production) |
| `EMAIL_PROVIDER` | `none` (default), `console` (development only, refused in production) or `resend` |
| `RESEND_API_KEY`, `EMAIL_FROM` | required for `resend`; server-only secret and the sender address |
| `GLOBAL_RATE_LIMIT_PER_MINUTE`, `LOG_LEVEL` | defaults `600` and `INFO` are fine |

**Supabase checklist:** the migrations applied (`make migrate`), Authentication → Multi-Factor →
TOTP enabled, the three Storage buckets with their limits (see *Storage buckets*), pg_cron
scheduled (see *Automatic expiry*), and the admin account created and given its role.
**The 5 MB / jpeg-png-webp limits on the buckets are enforced by Supabase, not by this app, so
set them carefully.**

**Logs.** The API writes one line per request (`request <id> METHOD /path -> status in N ms`; query
strings are never logged) and every response carries an `X-Request-ID` header. An unexpected error
returns `{"detail": "Internal server error", "request_id": ...}` and the full traceback is in the
server log under that id: when a customer reports a problem, ask for the id.

## Backups and recovery

Your data lives in Supabase PostgreSQL (orders, customers, products) and Supabase Storage
(pictures). **Check what your Supabase plan includes for backups** (some plans have none or only a
short history); do not rely on a plan you have not looked at. A dependable extra is your own dump.
The commands below were tested against the local database (the restored copy had identical row
counts, data, the migration version and both database functions); run the dump against the
Supabase *direct* connection string from Settings → Database (not the pooler):

```bash
# back up (schema + data, compressed)
pg_dump "postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres" -Fc -f shop-$(date +%F).dump

# prove a backup is usable: restore into a scratch database and compare
createdb restore_test
pg_restore -d restore_test --no-owner shop-2026-01-01.dump
psql restore_test -c "select count(*) from orders"
```

Keep dumps somewhere other than the machine that made them, and treat them as secret (they hold
customer names, addresses and phone numbers). Pictures in Storage are not in the dump: keep the
originals of your product photos. To recover: create a fresh Supabase project, run
`pg_restore --no-owner` into it, re-create the Storage buckets, set the environment variables, and
re-run the pg_cron schedule from this file. Restore only into an empty database.

## Tests

Backend database tests need the local Docker Postgres (`make db`); they use a separate
`crochet_test` database and are skipped if it is unavailable.
