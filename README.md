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
make frontend   # http://localhost:5173  (proxies /api to the backend)
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

After that, open `/admin` (an **Admin** link also appears on the home and account pages for this
account only). The admin area covers the dashboard, orders (including cancellation and refunds),
products and pictures, categories, customers, gallery, custom orders, messages, reviews and the
shop settings.

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

## Email (not connected yet)

No email service is chosen yet, so by default no email is sent (`EMAIL_PROVIDER=none`). To see
the emails the app would send, set `EMAIL_PROVIDER=console` in `backend/.env` and watch the
server log (development only; the app refuses it in production). The shop alerts (new orders,
custom orders, messages) go to the email address in the business settings:

```sql
update business_settings set email = 'you@example.com';
```

If the app runs behind a reverse proxy, also set `TRUST_PROXY_HEADERS=true` so rate limiting sees
the real client address (leave it `false` otherwise).

## Tests

Backend database tests need the local Docker Postgres (`make db`); they use a separate
`crochet_test` database and are skipped if it is unavailable.
