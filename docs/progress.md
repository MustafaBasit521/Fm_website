# Crochet Shop — Project Progress

## Current Phase

### Phase 0 — Architecture and Requirements

Status:

**Completed**

The following have been decided:

* frontend stack
* backend stack
* database
* authentication
* storage
* architecture
* core business rules
* order lifecycle
* payment states
* cancellation rules
* inventory behavior
* made-to-order capacity
* Lahore-only delivery
* wishlist model
* review eligibility
* admin scope
* MVP scope boundaries

---

# Finalized Decisions — Status

Status levels:

* **Decided/Documented** — agreed and written into `business-rules.md` / `database.md`
* **Designed** — technical design (tables, constraints, service flow) specified
* **Implemented** — code exists
* **Tested** — automated tests pass

Updating documentation does **not** mean a decision is implemented or tested.

| Decision | Decided/Documented | Designed | Implemented | Tested |
|---|---|---|---|---|
| 30-minute online payment window | Yes | Yes (`orders.payment_deadline_at`) | No | No |
| Payment retry during the window | Yes | Partly — payment-attempt representation still open | No | No |
| Automatic cancellation after expiry | Yes | Partly — cleanup mechanism still open | No | No |
| Inventory/capacity reservation and release | Yes | Yes (`database.md` §23–§24) | No | No |
| Online order Confirmed only after verified payment | Yes | Yes | No | No |
| COD payment confirmed on delivery by admin | Yes | Yes | No | No |
| Client-side cart for MVP (no cart tables) | Yes | Yes | No | No |
| Guest cancellation/address change via admin/contact flow | Yes | Yes | No | No |
| Processing cancellation charge = 50% of original total incl. delivery fee | Yes | Yes (`cancellation_charge_paisa`, `charge_waived`) | No | No |
| Review eligibility requires a Delivered order | Yes | Yes | No | No |
| One review per customer/product | Yes | Yes (`UNIQUE(customer_id, product_id)`) | No | No |
| Lahore-only delivery (canonical city value) | Yes | Yes | No | No |
| Made-to-order capacity measured in active units | Yes | Yes (`max_active_units`) | No | No |
| Database fields/constraints added (see `database.md`) | Yes | Yes | No | No |
| PostgreSQL ENUMs for controlled state values | Yes | Yes (`database.md` §3) | No | No |
| Explicit FK delete behavior | Yes | Yes (`database.md` §21) | No | No |
| Signed-URL image upload flow | Yes | Yes (`CLAUDE.md` §10) | No | No |

---

# Open Decisions (require approval)

* How a Processing-stage cancellation is requested (business-rules §15 allows only admin-performed cancellation from Processing onwards)
* Payment-attempt representation: one payment record updated in place vs one record per attempt (the status list has no "Failed" state)
* Mechanism for automatic cleanup of expired unpaid online orders
* Handling of a verified online payment that arrives after the 30-minute window has expired
* Exact anonymization/retention strategy for customer account deletion
* How the admin verifies a guest's identity for WhatsApp/contact requests
* Rounding rule when 50% of the total is not a whole paisa

---

# Technology Stack

## Frontend

* React
* TypeScript
* Vite
* Tailwind CSS

## Backend

* Python
* FastAPI
* Pydantic
* SQLAlchemy 2.x
* asyncpg
* Alembic

## Database

* PostgreSQL
* Supabase

## Authentication

* Supabase Auth

## Storage

* Supabase Storage

## Testing

* pytest
* Vitest

## Code Quality

* Ruff
* ESLint
* Prettier

---

# Implementation Order

## Phase 1 — Foundation

Status: **Complete — verified locally and against Supabase**

Tasks:

* [x] create repository structure (`backend/`, `frontend/`, `docs/`)
* [x] initialize frontend (Vite + React + TypeScript)
* [x] initialize backend (FastAPI app factory)
* [x] configure environment variables (`backend/.env.example`, `frontend/.env.example`; validated Pydantic settings)
* [x] configure FastAPI (CORS allow-list, docs disabled in production)
* [x] configure SQLAlchemy (async engine/session dependency, `Base`)
* [x] configure PostgreSQL connection (verified against local Docker Postgres 16)
* [x] configure Alembic (async env; empty baseline migration applied)
* [x] configure pytest (6 backend tests pass)
* [x] configure Vitest (2 frontend tests pass)
* [x] configure Ruff (clean)
* [x] configure ESLint (clean)
* [x] configure Prettier (clean)
* [x] create basic health-check endpoints (`GET /api/health`, `GET /api/health/db`)
* [x] establish development workflow (`Makefile`, `docker-compose.yml`, `README.md`)
* [x] Tailwind configured with design tokens from the UI mockups (colors, fonts)

Implementation notes:

* Local dev DB is a Docker Postgres (port 5433) in `docker-compose.yml`; it is dev-only. Production/staging use Supabase.
* Verified end to end: browser path Vite `/api` proxy -> FastAPI -> Postgres returns 200.
* Frontend production build succeeds.
* Verified against the Supabase project (PostgreSQL 17) via the **session pooler** (port 5432): `SELECT 1`, `GET /api/health/db` = 200, and the baseline Alembic migration applied. No application tables exist yet.
* Supabase project settings chosen: Data API disabled, automatic RLS enabled (the browser never queries tables; only FastAPI does).
* Not implemented (belongs to later phases): any tables, authentication, rate limiting, CI pipeline.

---

## Phase 2 — Authentication

Status: **Implemented and tested, except the live browser signup/login flow (see notes)**

Tasks:

* [x] Supabase Auth integration (frontend `supabase-js` client; backend verifies JWTs via the project's public JWKS, ES256 only)
* [x] customer authentication (signup with name, login, logout; email confirmation required by the project)
* [x] customer profile (`GET/PATCH /api/customers/me`; `customers` table + Alembic migration, matches `database.md` §4)
* [x] authentication dependency (`get_current_user`: signature, expiry, audience, issuer, required claims; generic 401)
* [x] admin authorization (`require_admin`: `app_metadata.role == "admin"`; `user_metadata` cannot grant it)
* [x] protected routes (frontend `ProtectedRoute`; UX only)
* [x] customer-only data access (identity comes only from the verified token; no `{id}` in customer routes)
* [x] admin-only data access (`/api/admin/*` router-level dependency; `GET /api/admin/me`)

Implementation notes:

* Tests: backend 30 passing (invalid/expired/forged/wrong-key/wrong-issuer/wrong-audience/HS256 tokens, admin vs customer vs `user_metadata` escalation, lazy customer creation, concurrent first request, validation, isolation); frontend 9 passing. Backend DB tests use a separate `crochet_test` database on the local Docker Postgres and are skipped if it is unavailable; they never touch Supabase.
* Verified against Supabase: `customers` migration applied (RLS on automatically); real JWKS fetched and parsed; live API returns 401 for missing, garbage and forged tokens.
* `customers` row is created lazily on the first authenticated `/api/customers/me` call from the token's email/name (`subscribed_to_updates` defaults TRUE per business-rules §7).
* The first admin is set up manually: see "Creating the admin" in `README.md`.
* **Not yet verified:** a real browser signup -> email confirmation -> login -> profile round trip against Supabase (needs a real inbox). Also not covered: login rate limiting (Supabase applies its own; app-level limits are Phase 10), account deletion/anonymization (open decision).

---

## Phase 3 — Catalog

Status: Not Started

Tasks:

* categories
* products
* product images
* product CRUD
* storefront
* product detail
* search
* filtering
* sorting
* pagination
* availability handling

---

## Phase 4 — Customer Features

Status: Not Started

Tasks:

* customer profile
* saved addresses
* wishlist
* wishlist → cart flow

---

## Phase 5 — Cart and Checkout

Status: Not Started

Tasks:

* client-side/browser cart (guest and authenticated; no cart tables)
* checkout
* Lahore validation
* address selection
* backend price validation
* delivery fee
* stock validation
* made-to-order capacity validation
* order creation
* inventory reservation
* 30-minute online payment window and automatic expiry

---

## Phase 6 — Orders

Status: Not Started

Tasks:

* order history
* order details
* admin order management
* order status transitions
* customer cancellation
* Processing cancellation charge
* address-change rules
* historical snapshots
* inventory release

---

## Phase 7 — Payments

Status: Not Started

Tasks:

* COD
* online payment provider selection
* payment initiation
* payment verification
* payment failure
* retry payment
* webhooks/callbacks
* idempotency
* refunds
* partial refunds

---

## Phase 8 — Engagement

Status: Not Started

Tasks:

* product reviews
* gallery
* custom orders
* contact messages
* notifications
* transactional email

---

## Phase 9 — Admin Dashboard

Status: Not Started

Tasks:

* dashboard
* product management
* category management
* order management
* customer management
* gallery management
* custom-order management
* message management
* business settings
* refund/cancellation management

---

## Phase 10 — Hardening

Status: Not Started

Tasks:

* security review
* authorization review
* input validation review
* file-upload security
* rate limiting
* performance review
* database indexes
* N+1 review
* accessibility review
* responsive review
* automated tests
* error handling
* logging
* backup/recovery documentation
* deployment configuration

---

# Current Next Step

Start with **Phase 1 — Foundation**.

Do not implement business features before the basic project structure, database connection, migrations, testing, and development tooling are working.

---

# Important Rule

Update this file as implementation progresses.

Use it to record:

* completed work
* current work
* blocked work
* important implementation decisions
* known issues

Do not turn this file into a second `CLAUDE.md`.

Permanent project instructions belong in `CLAUDE.md`.

Business behavior belongs in `business-rules.md`.

Database structure belongs in `database.md`.
