# Deployment guide (free start: Vercel + Render + Supabase)

The system has three parts. Do them **in this order**, because each step needs an address from the previous one.

| Part | Where | Why there |
|---|---|---|
| Database, logins, file storage | Supabase (already running) | managed, already used in development |
| API (FastAPI) | **Render** (free plan to start) | an always-on process: it sends emails after saving an order and keeps request limits in memory, which a serverless host would break |
| Shop website and admin website | **Vercel** (two projects) | they are static files |

Never paste a secret key into chat, into GitHub or into a file in this repository. Secrets are typed only into the Render or Vercel dashboards.

## Step 1: the API on Render

1. Render dashboard -> **New** -> **Blueprint** -> connect the GitHub repository `MustafaBasit521/Fm_website`. Render reads `render.yaml` and proposes the service `bundle-of-loops-api` (region Singapore, free plan).
2. It asks for the values marked `sync: false`. Type them in (copy them from your `backend/.env`, never from chat):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the same `postgresql+asyncpg://...` address you use locally (the Supabase pooler address) |
   | `SUPABASE_URL` | `https://<your-project>.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | the Supabase **secret** key (server only) |
   | `CORS_ORIGINS` | leave a placeholder for now, fill in at step 3 |
   | `FRONTEND_URL` | placeholder for now, fill in at step 3 |
   | `SMTP_USERNAME`, `SMTP_PASSWORD`, `EMAIL_FROM` | the shop's Gmail address, its **App Password**, and `Bundle of Loops <that gmail address>` (see the README, "Email without a domain") |
   | `CRON_SECRET` | a long random value (for example 40 random letters and digits) |

3. Create the service and wait for "Live". Note its address, e.g. `https://bundle-of-loops-api.onrender.com`.
4. Open `https://<that address>/api/health`: it must answer `{"status":"ok"}`.

The free plan sleeps after 15 minutes without a request (the first request then takes about 30 to 60 seconds). Step 5 keeps it awake. The `starter` plan never sleeps.

## Step 2: the two websites on Vercel

Create **two projects** from the same GitHub repository.

| | Shop | Admin |
|---|---|---|
| Project name | e.g. `bundle-of-loops` | e.g. `bundle-of-loops-admin` |
| Root Directory | `deploy/shop` | `deploy/admin` |
| Include source files outside of the Root Directory | **ON** (the build uses `../../frontend`) | **ON** |

Environment variables (Production), the same for both projects:

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | the Render address from step 1 (no trailing slash) |
| `VITE_SUPABASE_URL` | the Supabase project address |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the Supabase **publishable** key (public by design) |
| `VITE_SHOP_URL` | the shop's Vercel address (used by the admin's "View shop" button; set it on the admin project) |

**Before the first build**, replace the word `API_DOMAIN` in `deploy/shop/vercel.json` and `deploy/admin/vercel.json` with the Render host name (for example `bundle-of-loops-api.onrender.com`, without `https://`). It is the only address the sites may call besides Supabase. (Tell Claude the address and it will make the change and update the test that guards it.)

After the first build, note the two Vercel addresses.

## Step 3: tell the API about the sites

In the Render service's **Environment**:

- `CORS_ORIGINS` = `https://<shop address>,https://<admin address>` (exact addresses, no trailing slash)
- `FRONTEND_URL` = `https://<shop address>`

Save; Render restarts the service.

## Step 4: Supabase login settings

Supabase dashboard -> Authentication -> **URL Configuration**:

- **Site URL**: the shop's address.
- **Redirect URLs**: add the shop's and the admin's addresses.

Also (Authentication -> Emails -> SMTP Settings) enter the shop's Gmail details so sign-up emails are sent (README, "Email without a domain"), and turn "Confirm email" on.

## Step 5: the scheduled expiry call (also keeps the free API awake)

Run once in the Supabase SQL editor (your real Render address and the same `CRON_SECRET`):

```sql
create extension if not exists pg_net;
select cron.schedule('notify-expired-orders', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<render address>/api/internal/expire-orders',
    headers := jsonb_build_object('X-Cron-Secret', '<the CRON_SECRET>')
  )
$$);
```

Every 5 minutes it cancels expired unpaid orders, tells the customers once, and the regular traffic also stops the free API from sleeping.

## Step 6: first checks on the live sites

1. `https://<render address>/api/health` answers ok; `/docs` is **not** available (production).
2. The shop opens, shows products, and a **Cash on Delivery** test order can be placed; the shop owner's email receives the alert.
3. The admin opens at its own address, log in, set up the authenticator code (QR code) the first time, and see the dashboard.
4. Upload one product picture, one gallery picture, and send one custom-order request with a photo (needs the buckets in the README).
5. Place a transfer order, send a transaction number, confirm it in the admin.
6. Run `python -m app.tools.check_services` locally with the production values if you want one more summary.
7. Check the browser console of both sites: there must be no blocked-by-CSP errors (if there are, the address in `vercel.json` or `CORS_ORIGINS` is wrong).

## If something goes wrong

- **Blank site or "network error"**: the Render address in `VITE_API_BASE_URL` or in `vercel.json` is wrong, or the API is still waking up.
- **Browser says "blocked by CORS"**: `CORS_ORIGINS` does not contain the exact site address.
- **Login works but the admin says "no access"**: the admin account's role is not set (see the README for granting the admin role).
- **Emails do not arrive**: look at the Render logs for "Could not send email" (wrong App Password or sender), and spam folders.
- **Roll back**: Vercel -> Deployments -> choose the previous one -> "Promote to Production"; Render -> Deploys -> redeploy a previous commit.

## Later: your own domain

Buy the domain in the owner's name, add `www`, `admin` and `api` addresses in Vercel and Render, change `CORS_ORIGINS`, `FRONTEND_URL`, the Supabase URL settings and `vercel.json`, and verify the domain in Resend for customer emails.
