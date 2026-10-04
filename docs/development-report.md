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
