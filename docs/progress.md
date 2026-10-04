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
| Automatic cancellation after expiry | Yes | Yes (decided: pg_cron + SQL function `expire_unpaid_online_orders()`) | Yes (SQL function; scheduling step pending, see Phase 5) | Yes (function) |
| Inventory/capacity reservation and release | Yes | Yes (`database.md` §23–§24) | Yes (reserve at creation; release on expiry and on cancellation via one SQL function `release_order_stock`) | Yes |
| Online order Confirmed only after verified payment | Yes | Yes | No | No |
| COD payment confirmed on delivery by admin | Yes | Yes | No | No |
| Client-side cart for MVP (no cart tables) | Yes | Yes | Yes | Yes |
| Guest cancellation/address change via admin/contact flow | Yes | Yes | Yes (admin endpoints; guests have no website route) | Yes |
| Processing cancellation charge = 50% of original total incl. delivery fee | Yes | Yes (`cancellation_charge_paisa`, `charge_waived`) | Yes (admin cancel; floor rounding; waive option; unpaid COD waived) | Yes |
| Review eligibility requires a Delivered order | Yes | Yes | No | No |
| One review per customer/product | Yes | Yes (`UNIQUE(customer_id, product_id)`) | No | No |
| Lahore-only delivery (canonical city value) | Yes | Yes | Yes (at checkout) | Yes |
| Made-to-order capacity measured in active units | Yes | Yes (`max_active_units`) | Yes | Yes |
| Database fields/constraints added (see `database.md`) | Yes | Yes | Partly (customers, catalog, addresses, wishlist, orders, order_items, payments, business_settings) | Yes (constraints exercised by tests) |
| PostgreSQL ENUMs for controlled state values | Yes | Yes (`database.md` §3) | Partly (product_availability, order_status, payment_status, payment_method) | Yes |
| Explicit FK delete behavior | Yes | Yes (`database.md` §21) | Partly (all tables created so far) | Yes (cascade/restrict/set-null tests) |
| Signed-URL image upload flow | Yes | Yes (`CLAUDE.md` §10) | No | No |

---

# Open Decisions (require approval)

Decided: expired unpaid online orders are cleaned up by a PostgreSQL function (`expire_unpaid_online_orders()`) scheduled with Supabase pg_cron (Phase 5).

Decided (Phase 6): a customer asks to cancel a Processing order by contacting the shop (no request button; the admin cancels). The 50% Processing charge is rounded down to a whole paisa.

* Payment-attempt representation: one payment record updated in place vs one record per attempt (the status list has no "Failed" state)
* Handling of a verified online payment that arrives after the 30-minute window has expired
* Exact anonymization/retention strategy for customer account deletion
* How the admin verifies a guest's identity for WhatsApp/contact requests

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

Status: **Implemented and tested, except live Supabase Storage uploads (see notes)**

Tasks:

* [x] categories (table + migration seeding the six initial categories; admin create/rename/delete; delete blocked while products exist)
* [x] products (table, PostgreSQL enum `product_availability`, CHECK constraints, indexes; matches `database.md` §7)
* [x] product images (table; admin register/update/delete metadata; server-generated storage paths, path validation)
* [x] product CRUD (admin API, admin-only, validated; delete removes image rows and requests Storage file deletion)
* [x] storefront (shop listing page; only visible products are ever returned)
* [x] product detail (public API + page with image gallery)
* [x] search (name/description, case-insensitive, LIKE wildcards escaped)
* [x] filtering (category, availability type, available-only, featured, price range)
* [x] sorting (newest, price asc/desc, name; stable tie-break)
* [x] pagination (page/page_size, max 50 public)
* [x] availability handling (ready-to-ship: stock > 0; made-to-order: capacity > active units)
* [~] signed-URL image upload (endpoint implemented and unit-tested against a mocked Storage API; **not yet run against real Supabase Storage**)

Implementation notes:

* Tests: backend 86 passing (adds public filters/sort/pagination/visibility, admin authorization on every admin route, validation, category rules, image path validation/scoping, product-delete cascade, Storage client request shapes). Frontend 19 passing (adds shop/product pages, price formatting).
* Verified against Supabase: catalog migration applied; 6 categories seeded; live `GET /api/categories`, `GET /api/products` and 401 on admin routes work.
* **Made-to-order capacity:** `active_units` is a single function (`active_units_expr`) that returns 0 until orders exist (Phase 5). Until then a made-to-order product is available iff `max_active_units > 0`. Phase 5 must replace it with the real aggregate (`database.md` §24).
* New products default to hidden (`is_visible=false`) until the admin publishes them.
* To enable image upload: create the `product-images` bucket in Supabase (public, 5 MB limit, MIME types jpeg/png/webp) and set `SUPABASE_SERVICE_KEY` (server-only) in `backend/.env`. See `README.md`.
* Not in this phase: admin UI screens (Phase 9), homepage featured section, reviews/wishlist integration, stock reservation (Phase 5).

---

## Phase 4 — Customer Features

Status: **Implemented and tested, except "wishlist -> cart", which is deferred to Phase 5**

Tasks:

* [x] customer profile (done in Phase 2: `GET/PATCH /api/customers/me`, profile page)
* [x] saved addresses (`addresses` table + migration per `database.md` §5; `GET/POST /api/customers/me/addresses`, `PATCH/DELETE .../{id}`; addresses page)
* [x] wishlist (`wishlist_items` table + migration per `database.md` §12; list, ids, add, remove; wishlist page; wishlist button on the product page)
* [ ] wishlist -> cart flow — **deferred to Phase 5**: the cart is a client-side feature (`business-rules.md` §11) that does not exist yet. The wishlist page is ready for an "Add to cart" action once the cart exists.

Implementation notes:

* Tests: backend 115 passing (adds login checks on every route; one customer can never see another's data; required-field and validation rules; uniqueness, concurrent double-add, hidden products, cascade deletes of customers and products); frontend 35 passing (adds addresses, wishlist, wishlist button).
* Verified against Supabase: migration applied; both new tables have the documented `ON DELETE CASCADE` foreign keys and RLS enabled; live routes return 401 without a valid token.
* Decisions (not specified in the docs, easy to change): saved addresses accept any city and Lahore-only is enforced at checkout (Phase 5, `business-rules.md` §10); a technical cap of 20 saved addresses per customer; `wishlist_items` uses a composite primary key `(customer_id, product_id)` to implement the documented uniqueness; hidden products are not shown in the wishlist (their rows are kept) and cannot be added; adding a product that is already saved returns 409.
* Other customers' addresses return 404, not 403, so their existence is not revealed.
* Not verified: a real browser run of the new pages against Supabase.

---

## Phase 5 — Cart and Checkout

Status: **Implemented and tested, except enabling pg_cron on Supabase (manual step) and online payment (Phase 7)**

Tasks:

* [x] client-side/browser cart (guest and authenticated; ids + quantities in localStorage; no cart tables; add-to-cart on product page and wishlist; cart page)
* [x] checkout (`POST /api/checkout/quote`, `POST /api/orders`; guest and registered; confirmation page)
* [x] Lahore validation (server-side, canonical city `Lahore`; saved addresses are validated at checkout too)
* [x] address selection (saved address id for registered customers, or inline address)
* [x] backend price validation (client sends only ids/quantities; optional expected total, mismatch returns 409 `TOTAL_CHANGED`)
* [x] delivery fee (`business_settings`, seeded Rs 200)
* [x] stock validation
* [x] made-to-order capacity validation (units held by Pending/Confirmed/Processing orders)
* [x] order creation (one transaction: lock products in id order, validate, reserve, create order + items + payment row; guest orders have no customer)
* [x] inventory reservation (ready-to-ship stock decremented at creation; made-to-order capacity reserved by the active order itself)
* [~] 30-minute online payment window and automatic expiry — the window, `payment_deadline_at` and the SQL expiry function are implemented and tested; **the pg_cron schedule is not yet enabled on Supabase** (one-time manual SQL, see `README.md`). Customers cannot use online payment until Phase 7 (`ONLINE_PAYMENTS_ENABLED=false`), so the window is exercised only by tests for now.

Implementation notes:

* Tests: backend 163 passing (adds quote and order rules, Lahore-only, address ownership, optional-auth rules, all-or-nothing reservation, snapshots surviving product edits/deletion, expiry function, DB constraints); the test database is now built by the real Alembic migrations. Frontend 57 passing (adds cart store, cart/checkout/confirmation pages, add-to-cart, wishlist -> cart).
* Concurrency tested: six simultaneous buyers of the last unit -> exactly one order, stock never negative; made-to-order capacity of 2 under six simultaneous orders -> exactly two succeed; opposite-order multi-item carts do not deadlock.
* A real race was found by these tests and fixed: made-to-order active units must be read in a separate statement after the product row lock is held (READ COMMITTED does not refresh a subquery in the locking statement).
* Verified against Supabase: migration applied (tables, enums, seeded delivery fee Rs 200, expiry function; dry run returned 0; RLS on); live `quote` and `orders` validation responses behave as designed. No real orders were created there.
* The expiry function is the only implementation of expiry; the API also calls it just before reserving stock, so correctness does not depend on the cron schedule (the schedule frees stock when nobody is ordering).
* `payments`: one PENDING row is created with each order. How retries are represented stays an open decision (compatible with either option).
* Decisions (not in the docs, easy to change): `ONLINE_PAYMENTS_ENABLED` defaults to false so nobody places an order they cannot pay for; quantity cap 99 per line and 50 lines per order (technical limits); FKs from `order_items`/`payments` to `orders` use RESTRICT (orders are never deleted); an optional `expected_total_paisa` protects customers from price changes.
* Known gaps, deliberately left for later: no rate limiting on order creation (a guest could reserve stock with fake COD orders; Phase 10); no idempotency key against double submits; an expired order's payment row stays PENDING (the payment_status enum has no cancelled/failed state); changing a product's availability type while orders are active is not blocked (Phase 9); guests have no order lookup (Phase 6 decides how); notification/confirmation emails (Phase 8).

---

## Phase 6 — Orders

Status: **Implemented and tested** (admin order management is the API only; the admin screens are Phase 9. Refund execution is Phase 7.)

Tasks:

* [x] order history (`GET /api/orders`, paginated, newest first; page `/orders`)
* [x] order details (`GET /api/orders/{id}`; page `/orders/:id`; own orders only, others return 404)
* [x] admin order management (`/api/admin/orders`: list with status/payment/search filters and pagination, detail, status change, cancel, address change; admin-only)
* [x] order status transitions (admin moves one step forward only: Pending -> Confirmed -> Processing -> Shipped -> Delivered; an online order cannot be Confirmed until its payment is Paid; terminal states never move)
* [x] customer cancellation (registered customers, own orders, Pending/Confirmed only; Processing returns "contact the shop"; Shipped/Delivered/Cancelled refused)
* [x] Processing cancellation charge (admin cancel: 50% of the total incl. delivery fee, rounded down; unpaid COD charge waived automatically; admin may waive; recorded on the order)
* [x] address-change rules (registered customer or admin: Pending/Confirmed only; same Lahore-only validation and saved-address ownership checks as checkout; guests go through the admin)
* [x] historical snapshots (orders keep customer, delivery, product name and price snapshots; verified to survive product edits and deletion)
* [x] inventory release (`release_order_stock()` SQL function shared by cancellation and the payment-window expiry; ready-to-ship stock returns, made-to-order capacity frees itself)

Implementation notes:

* Tests: backend 208 passing (adds customer history/privacy, every cancellation state, charge maths, concurrent double-cancel returning stock exactly once, cancel-vs-status-change race, address rules, admin authorization on every route, listing filters); frontend 69 passing (adds orders list and order detail pages).
* Verified against Supabase: migration applied; both functions present; expiry dry run returned 0.
* The expiry function was refactored to call `release_order_stock()`, so there is one implementation of stock release; its existing tests still pass.
* Refunds: Phase 6 records the charge and shows `refund_due_paisa` (amount paid - charge - already refunded, for cancelled paid orders). Actual refunds and payment-status changes (Partially Refunded / Refunded) are Phase 7. COD "payment received" confirmation (Payment = Paid when Delivered) is also Phase 7 (COD task).
* Decisions (not in the docs, easy to change): status changes move strictly one step forward; the status endpoint refuses Cancelled (use the cancel action); admin may cancel from Pending, Confirmed or Processing; `payments[-1]` is treated as the current payment (matters once retries exist).
* Known gaps, left for later: no notification emails on status changes (Phase 8); guests still cannot look up an order on the website (they contact the shop); the order list has no date filter; stock release uses the product's current availability type, so changing a product's type while orders are active could misplace stock (to be blocked in the admin phase).
* Not verified: a real browser run of the new order pages against Supabase.

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
