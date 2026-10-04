# Crochet Shop — Development Report

A running log of what was built, how it was verified, and why. Newest entries last.
Status of each phase lives in `progress.md`; business rules and schema live in `business-rules.md` and `database.md`.

---

## Phase 1 — Foundation

**Built**

* Backend (`backend/`): FastAPI app factory, validated settings (`DATABASE_URL` must use `postgresql+asyncpg://`), CORS allow-list, async SQLAlchemy engine + per-request session, Alembic (async) with an empty baseline migration, `GET /api/health` (liveness) and `GET /api/health/db` (readiness, no error details leaked).
* Frontend (`frontend/`): Vite + React + TypeScript, Tailwind with design tokens from the UI mockups, Vitest, ESLint, Prettier, small API client (`src/lib/api.ts`).
* Workflow: `docker-compose.yml` (dev-only Postgres on 5433), `Makefile`, `README.md`, `.env.example` files, `.gitignore`.

**Verified**

* Ruff, ESLint, Prettier clean; 6 backend + 2 frontend tests pass; production build succeeds.
* Vite proxy → FastAPI → Postgres works, both on local Docker and on the Supabase project (session pooler, PostgreSQL 17); baseline migration applied to both.

**Decisions / notes**

* Docker Postgres is for local development only; production uses Supabase.
* Supabase project: Data API disabled, automatic RLS enabled (only FastAPI queries tables).
* Alembic is the only schema-migration system (Supabase's GitHub migration integration must stay off).
* Fixed during the work: comma-separated `CORS_ORIGINS` parsing; Google Fonts moved from CSS `@import` to `<link>` tags.

---

## Phase 2 — Authentication

**Design (following CLAUDE.md §6, database.md §4, business-rules §6–8)**

* Supabase Auth owns credentials; the backend never sees passwords. The browser logs in with `supabase-js` and sends the access token as `Authorization: Bearer ...` to FastAPI.
* FastAPI verifies the token locally using the project's **public** signing key from the JWKS endpoint, so no Supabase secret is stored on the server. The algorithm list is pinned to ES256 (blocks `none`/HS256 algorithm-confusion attacks); `exp`, `sub`, `aud` (`authenticated`) and `iss` are required.
* Authorization uses only server-controlled claims. Admin = `app_metadata.role == "admin"`; `user_metadata` (user-editable) is read only for the display name.
* The application `customers` row (id = Supabase user id) is created lazily on first `/api/customers/me`, using `INSERT ... ON CONFLICT DO NOTHING` so simultaneous first requests are safe.

**Built**

* Backend: `app/core/auth.py` (verification + `get_current_user` / `require_admin`), `app/models/customer.py`, migration `create customers`, `app/schemas/customer.py`, `app/services/customers.py`, routers `api/customers.py` and `api/admin.py`.
* Frontend: `lib/supabase.ts`, token-attaching API client, `AuthProvider`/`useAuth`, `ProtectedRoute`, Login / Register / Account pages, routing.

**Verified**

* Backend 30 tests, frontend 9 tests, Ruff/ESLint/Prettier clean, production build OK, migration applied on Supabase, live JWKS fetch OK, live 401 checks OK.
* Not verified: the real browser signup/login round trip (email confirmation needs a real inbox).

**Decisions / notes**

* Lazy customer creation instead of a database trigger on `auth.users`: keeps all logic in FastAPI and avoids coupling to Supabase internals.
* Email and id are not editable through `PATCH /customers/me`; extra fields are rejected (422).
* Duplicate email for a different Supabase user returns 409 rather than overwriting.
* Login errors are deliberately generic to avoid revealing which emails exist.
* Open decisions from `progress.md` (account deletion/anonymization) were not touched.

---

## Phase 3 — Catalog

**Design (CLAUDE.md §8, §10, §13; database.md §6–8, §22, §24; business-rules §1–5)**

* Tables `categories`, `products`, `product_images` with the documented constraints, FK behaviour (`products.category_id` RESTRICT, `product_images.product_id` CASCADE) and enum `product_availability`. The migration seeds the six initial categories and its downgrade also drops the enum type (tested up/down/up).
* Public API (`/api/categories`, `/api/products`, `/api/products/{id}`) only ever returns visible products and does not expose stock, capacity, visibility or timestamps. Admin API (`/api/admin/...`) uses a router-level `require_admin`.
* Listing uses one count query plus one page query with `selectinload` for category and images (no N+1). Filters, search, sort and page size are validated by FastAPI; search escapes `%`, `_` and `\`.
* Image upload follows CLAUDE.md §10: the admin asks FastAPI for a signed upload URL, the browser uploads straight to Storage, then registers the path. Storage paths are generated server-side (`products/{product_id}/{uuid}.{ext}`); the client filename is never used, only jpeg/png/webp are accepted, and registered paths must match that exact pattern for that product (blocks traversal, other products' folders, other hosts). The service key is server-only and never appears in any response or log (tested).
* Deleting a product deletes its DB rows first, then asks Storage to delete the files. A Storage failure is logged and leaves an orphan file rather than a broken product.

**Built**

* Backend: `models/catalog.py`, `models/enums.py`, migration `create catalog tables`, `schemas/catalog.py`, `services/catalog.py`, `core/storage.py`, routers `api/catalog.py` and `api/admin_catalog.py`.
* Frontend: `ShopPage` (URL-driven filters, pagination, loading/empty/error states), `ProductPage` (gallery, availability), `ProductCard`, `lib/money.ts` (integer-only price formatting), API types/clients.

**Verified**

* Backend 86 tests, frontend 19 tests, Ruff/ESLint/Prettier clean, production build OK, migration applied on Supabase, live public endpoints and admin 401 OK, Vite proxy to API OK.

**Bugs found by tests and fixed**

* Deleting a product with images tried to NULL `product_images.product_id` (missing ORM delete cascade) — fixed with `cascade="all, delete-orphan"` plus `passive_deletes`.
* Frontend: React hooks lint forbade synchronous state resets in effects; responses are now tagged with the query/id they answer and loading is derived (also avoids stale results).

**Decisions / notes**

* Made-to-order capacity placeholder (see `progress.md`): to be replaced in Phase 5.
* `is_visible` defaults to false for new products (a small decision not stated in the docs; easy to change).
* Not verified: the real Supabase Storage signed-upload and delete calls (need the bucket and the service key); the mocked-transport tests only prove our request/response handling.

---

## Phase 4 — Customer Features

**Design (CLAUDE.md §6, §13; database.md §5, §12, §21; business-rules §8–11, §25)**

* All routes live under `/api/customers/me/...` and take the owner only from the verified token; there is no customer id in any path or body. Address queries include `customer_id` in the WHERE clause, so another customer's address is simply not found (404).
* First write creates the `customers` row if needed (`get_or_create_customer`), so saving an address or wishlisting a product as the very first call satisfies the foreign key.
* Wishlist add uses `INSERT ... ON CONFLICT DO NOTHING RETURNING`, so concurrent double-clicks produce exactly one row (one 201, the rest 409). Remove is idempotent.
* Hidden products are filtered out of the wishlist view and cannot be added, but existing rows survive so a product the admin re-publishes reappears.
* Frontend: addresses page (add/edit/two-step delete, blank optional fields sent as null), wishlist page (remove, pagination, loading/empty/error), wishlist button (signed-out visitors see a login link and trigger no API calls; a 409 is treated as success).

**Built**

* Backend: `models/customer_data.py`, migration `create addresses and wishlist`, `schemas/address.py`, `schemas/wishlist.py`, `services/addresses.py`, `services/wishlist.py`, routers `api/addresses.py` and `api/wishlist.py`.
* Frontend: `AddressesPage`, `WishlistPage`, `WishlistButton`, API client additions (including 204 handling), links from the account page.

**Verified**

* Backend 115 tests, frontend 35 tests, Ruff/ESLint/Prettier clean, production build OK, migration applied on Supabase, FK delete rules and RLS confirmed there, live 401 checks OK.

**Problems found and fixed during the work**

* `ProductCard` rendered an `<li>` while the wishlist page wrapped cards in a `<div>` inside a `<ul>` (invalid list structure for assistive tech); cards are now plain elements and each page wraps them in `<li>`.
* The product page test needed an auth context once it contained the wishlist button.

**Decisions / notes**

* "Wishlist -> cart" deferred to Phase 5 (cart does not exist yet); see `progress.md`.
* The production bundle is now ~490 kB (Vite warns above 500 kB). Code splitting is a Phase 10 performance item, not done now.

---

## Phase 5 — Cart and Checkout

**Design (CLAUDE.md §14–15; business-rules §10–13, §24; database.md §9–11, §18, §23–24)**

* The cart lives only in the browser (ids and quantities). The backend never accepts prices: `POST /api/checkout/quote` returns authoritative lines, availability issues, delivery fee and total; `POST /api/orders` recomputes everything again inside the order transaction.
* Order creation is one transaction: lock the product rows (`FOR UPDATE`, ordered by id so opposite-order carts cannot deadlock), re-evaluate every line, reserve ready-to-ship stock, then insert order, items (name/price snapshots) and a PENDING payment row. Any problem rolls everything back (all-or-nothing). The `stock_quantity >= 0` CHECK is the last backstop.
* Made-to-order capacity is derived (units in Pending/Confirmed/Processing orders), so there is no counter to keep in sync, and cancelling or shipping an order frees capacity automatically.
* Lahore is enforced server-side for inline and saved addresses; the city is stored canonically. Saved-address ids are resolved with the owner in the query, so another customer's address is "not found". A guest cannot use a saved address.
* The order endpoint takes an optional login: a missing token is a guest order, but a token that is sent and is invalid or expired is a 401, never a silent downgrade to a guest order.
* Expiry (decided with the owner: pg_cron + SQL function): `expire_unpaid_online_orders()` selects overdue unpaid online orders with `FOR UPDATE SKIP LOCKED`, cancels them, and returns ready-to-ship stock. An advisory lock serializes runs. The API calls the same function before reserving stock, so the schedule is an optimization for freeing stock, not a correctness dependency.
* Online payment is refused until the payment phase (`ONLINE_PAYMENTS_ENABLED=false`).

**Built**

* Backend: `models/orders.py` (orders, order_items, payments), `models/business_settings.py`, enums, migration (tables, seed Rs 200 fee, SQL function, clean downgrade), `schemas/checkout.py`, `services/checkout.py`, `api/checkout.py`, `get_optional_user`, catalog availability now uses real active order units.
* Frontend: cart store (`lib/cart.ts`, `CartProvider`), `AddToCartButton`, `CartLink`, `CartPage`, `CheckoutPage`, `OrderConfirmationPage`, structured API errors (`ApiError.code`), wishlist -> cart action.

**Verified**

* Backend 163 tests, frontend 57 tests, Ruff/ESLint/Prettier clean, build OK, migration applied on Supabase, live validation responses OK. Tests build the schema from the real migrations.

**Bugs found by tests and fixed**

* Made-to-order oversell race: six concurrent orders passed a capacity of 2 because the active-units subquery used the statement's old snapshot after waiting for the row lock. Fix: lock first, then read active units in a separate statement.
* Test-only mistakes: tests that created the database with `create_all` missed the SQL function (tests now run the real migrations); an expiry test forgot that placing an order also expires overdue ones.

**Decisions / notes**

* See `progress.md` for the decisions and known gaps (rate limiting, double-submit, payment status after expiry, product type changes, guest order lookup).
* pg_cron is available on the Supabase project but not enabled; enabling it is a one-time manual step (README).

---

## Phase 6 — Orders

**Design (CLAUDE.md §14; business-rules §14–19, §24; database.md §9, §23)**

* Decisions taken with the owner: a customer asks for a Processing cancellation by contacting the shop (admin performs it; no request flow), and the 50% charge is rounded down (`total * 1 // 2`).
* All state rules live in `services/orders.py` and are enforced server-side; the UI only decides what to show. Every state-changing operation first locks the order row (`FOR UPDATE`) and only then checks the state, so concurrent cancel / status change / expiry cannot interleave.
* Stock release is implemented once, in the SQL function `release_order_stock()` (locks the affected products in id order, matching checkout, to avoid deadlocks). The expiry function and the Python cancellation both call it. Made-to-order capacity needs no release because it is derived from active orders.
* Customer routes reach only the caller's own orders (another customer's or a guest order is a 404). Guest orders have no website route; the admin handles them (cancel / address change) as the docs require.
* Cancellation terms: Pending/Confirmed -> no charge; Processing (admin only) -> unpaid COD or waived: charge 0 and `charge_waived = true`, otherwise 50% rounded down; Shipped/Delivered/Cancelled -> refused. `refund_due_paisa` is computed (paid amount - charge - already refunded) for cancelled paid orders; money movement itself is Phase 7.
* Address change reuses checkout's delivery resolution (Lahore-only, saved-address ownership) and keeps the existing recipient name when none is given.

**Built**

* Backend: migration `release order stock function`, `schemas/orders.py`, `services/orders.py`, routers `api/orders.py` and `api/admin_orders.py`; the order response gained cancellation fields.
* Frontend: `OrdersPage`, `OrderDetailPage` (cancel with confirmation, address change, per-status messages), status labels in words (never colour alone), links from the account page.

**Verified**

* Backend 208 tests, frontend 69 tests, Ruff/ESLint/Prettier clean, build OK, migration applied on Supabase, live auth checks on the new routes.

**Notes**

* The expiry function was rewritten as a loop over overdue orders calling the shared release function; behaviour is unchanged (all 8 expiry tests pass unchanged).
* `make check` now takes a little over two minutes because of the database-backed backend suite.
