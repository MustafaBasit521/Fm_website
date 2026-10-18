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
| 30-minute online payment window | Yes | Yes (`orders.payment_deadline_at`) | Yes (deadline, expiry function; pg_cron schedule is a manual step; online payment itself needs a gateway) | Yes |
| Payment retry during the window | Yes | Yes (one payments row per attempt, FAILED status) | Yes (against the fake provider) | Yes |
| Automatic cancellation after expiry | Yes | Yes (decided: pg_cron + SQL function `expire_unpaid_online_orders()`) | Yes (SQL function; scheduling step pending, see Phase 5) | Yes (function) |
| Inventory/capacity reservation and release | Yes | Yes (`database.md` §23–§24) | Yes (reserve at creation; release on expiry and on cancellation via one SQL function `release_order_stock`) | Yes |
| Online order Confirmed only after verified payment | Yes | Yes | Yes (provider-verified only) | Yes |
| COD payment confirmed on delivery by admin | Yes | Yes | Yes | Yes |
| Client-side cart for MVP (no cart tables) | Yes | Yes | Yes | Yes |
| Guest cancellation/address change via admin/contact flow | Yes | Yes | Yes (admin endpoints; guests have no website route) | Yes |
| Processing cancellation charge = 50% of original total incl. delivery fee | Yes | Yes (`cancellation_charge_paisa`, `charge_waived`) | Yes (admin cancel; floor rounding; waive option; unpaid COD waived) | Yes |
| Review eligibility requires a Delivered order | Yes | Yes | Yes | Yes |
| One review per customer/product | Yes | Yes (`UNIQUE(customer_id, product_id)`) | Yes | Yes |
| Lahore-only delivery (canonical city value) | Yes | Yes | Yes (at checkout) | Yes |
| Made-to-order capacity measured in active units | Yes | Yes (`max_active_units`) | Yes | Yes |
| Database fields/constraints added (see `database.md`) | Yes | Yes | Yes (every table in `database.md`) | Yes (constraints exercised by tests) |
| PostgreSQL ENUMs for controlled state values | Yes | Yes (`database.md` §3) | Yes (all enums in `database.md` §3, incl. custom_order_status, notification_type/status) | Yes |
| Explicit FK delete behavior | Yes | Yes (`database.md` §21) | Yes (all tables) | Yes (cascade/restrict/set-null tests) |
| Signed-URL image upload flow | Yes | Yes (`CLAUDE.md` §10) | Yes (product images, gallery, private custom-order references) | Yes against mocked Storage; real Supabase Storage calls not yet verified |

---

# Open Decisions (require approval)

Decided: expired unpaid online orders are cleaned up by a PostgreSQL function (`expire_unpaid_online_orders()`) scheduled with Supabase pg_cron (Phase 5).

Decided (Phase 9): the settings screen offers only the fields in business-rules §33 (no holiday mode or payment toggles, which appear in the mockup but not in the rules).

Decided (Phase 8): custom orders go NEW > IN_DISCUSSION > ACCEPTED > IN_PROGRESS > COMPLETED, plus DECLINED / CANCELLED; customers may edit/delete their own review and the admin may remove any; notifications are UNREAD/READ and NEW_PRODUCT moves to Phase 9; the email provider is chosen later (emails are built behind a provider interface).

Decided (Phase 7): each online payment attempt is its own `payments` row with a new `FAILED` status; a verified payment that arrives after the window closes leaves the order Cancelled and is refundable in full.

Decided (Phase 6): a customer asks to cancel a Processing order by contacting the shop (no request button; the admin cancels). The 50% Processing charge is rounded down to a whole paisa.

* Which payment gateway to use (CLAUDE.md §3: must be chosen and documented before provider-specific code). Deferred by the owner; Phase 7 is built against a provider interface.
* Which transactional email service to use (CLAUDE.md §3: choose before provider-specific code). Deferred by the owner; Phase 8 is built against a provider interface with a log-only development provider.
* Exact anonymization/retention strategy for customer account deletion
* How the admin verifies a guest's identity for WhatsApp/contact requests

---

# Documentation Sync

After Phase 6, `business-rules.md` and `database.md` were updated to record every decision and implementation detail from Phases 1–6 (CLAUDE.md §24): defaults, indexes, composite wishlist key, RESTRICT foreign keys, the seeded delivery fee, the expiry mechanism, cancellation/charge rules and the two database functions (`database.md` §27). Each phase from now on updates all three documents.

---

# UI Polish (after Phase 10)

Status: **In progress.** The owner asked for the storefront to follow the project's own mockup (`UI mockups for craft e-commerce`: `Design System.dc.html`, `Home.dc.html`, `Admin Dashboard.dc.html`) with the better layout ideas of a reference shop (search at the top, filters out of the way).

Done — shop site:

* [x] design-system alignment: page colour is Cream `#F5EFE6`, cards/inputs/panels Paper `#FBF8F3` (these two were swapped before), new tokens (linen, accent hover/tint, attention); pill buttons 48 px (dark = main action, accent = commit actions such as Add to bag / Place order, outlined = secondary); inputs with 10 px corners and the dashed "stitched" focus ring; 18 px cards; dark radio/checkbox colour
* [x] storefront frame (`src/shop/ShopLayout.tsx`): announcement bar, header (menu on phones, nav on desktop, search, wishlist, account, bag with count), footer with contact details from the settings, skip link; the shop name is shown as the logo with the italic orange "of" (`ShopName`), taken from the business settings (fallback "Bundle of Loops"), also used in emails
* [x] search (icon in the header opens a search bar), shop page (category pills, product count, Filters drawer, removable filter chips), product cards in the mockup style, home page (hero wording, promise strip, featured collection)
* [x] product page: large image with thumbnails, category eyebrow, price, availability dot and words, quantity stepper, "Add to bag · total" and a wishlist button
* [x] "Your bag" page: line cards with image, stepper and Remove, order summary beside them (Subtotal, Delivery in Lahore, Total) and "Proceed to checkout"
* [x] checkout: contact, delivery and payment as cards (payment and saved addresses as selectable cards), order summary with "Place order · total"
* [x] coloured order-status badges from the design system (words always shown; AA contrast tested) in the shop's order list and order page and in the admin's dashboard, orders, order page and customer page
* [x] the live shop name is changed to "Bundle of Loops" by a migration (only if it still holds the old default), so no manual database edit is needed
* [x] account area: an account hub with tiles (orders, wishlist, addresses, custom orders, notifications) above the details form; the order confirmation and order pages share one items-and-totals card (`OrderBreakdown`); hearts on product cards for signed-in shoppers (shop and home; signed-out visitors see none and nothing is requested)
* [x] remaining shop pages restyled with the design system: gallery ("From the studio table" with type pills), custom order (the mockup's headline, three-step explanation, form card, dashed upload zone, "no payment now" note), contact ("Say hello" with a details card and WhatsApp button beside the form), login and register (centred card), and a shared `PageHeader` (eyebrow, serif title, intro) on the orders, custom orders, addresses, notifications and wishlist pages; custom-order statuses use the same coloured badges
* [x] wording follows the mockup: "bag" instead of "cart" on screen (URLs and code names unchanged)
* [x] accessible drawer; colour-contrast matrix over every text colour on every surface (passes AA); axe on every page; guards: no non-wrapping rows (`flex-nowrap` marks deliberate ones)
* [x] panels instead of pages for quick actions: the **bag** and the **wishlist** open as panels sliding in from the right (slide-in and slide-out animation, switched off for visitors who prefer reduced motion), **search** drops from the top as a sheet with live results (pictures, name, price; starts at two letters, waits 250 ms after typing); the full `/cart` and `/wishlist` pages still exist. The heart in the header is shown to everyone (signed out: the panel invites to log in) and counts saved pieces; wishlist state is now shared (`WishlistProvider`)
* [x] header navigation is Shop / Custom order / Contact; the **Gallery** is a section on the home page (six photos and a button to the full `/gallery` page, which stays and is linked from the footer)
* [x] dark footer (ink background; light text meets AA) with Explore and Get in touch columns
* [x] "Join the circle" newsletter block above the footer, backend (`/api/newsletter`, `/api/newsletter/unsubscribe`, table `newsletter_subscribers`), unsubscribe page `/unsubscribe`, welcome and new-product emails (see business-rules §7, §31)
* [x] home hero shows real photos of the featured pieces (nothing is shown when no piece has a photo yet); a "Customize anything" band leads to the custom-order page
* [x] custom-order page: "what are you after?" chips (written at the top of the description), name/WhatsApp and budget/date in two columns, dashed upload zone
* [x] design deck `bundleofloops.pdf` (local reference, git-ignored) compared with the build: home hero is now a photo collage with an "In the photo" caption card and an inset second photo; the **admin chooses the hero photos** in the Gallery page ("Top of the home page" tick, migration `gallery show in hero`, applied on Supabase); custom-order page follows the deck (headline and numbered dashed steps on the left, "Tell us about it" form card on the right); contact page is two columns with a two-column form (the old layout left a large empty area when the shop details are empty); footer has WhatsApp/social pills and a dashed divider
* [x] speed: the API was slow from Lahore because the database is in Tokyo and the connection pool pinged it on every request (about 0.6 s). The ping is off (idle connections are recycled after 4 minutes instead), public product queries load the category in the same query, and the shop details are fetched once per page load instead of on every page. Measured on the owner's machine: settings 1.0 s to 0.4 s, gallery 1.3 s to 0.6 s, products 1.6 s to 1.0 s. The rest is distance to the database (see "Known limits")
* [x] WhatsApp click-to-chat (no WhatsApp API, nothing sent by the shop): a round button on every page, "Ask about this on WhatsApp" on the product page (name, price and link typed in), "Or send this on WhatsApp" on the custom-order form (what was typed so far; nothing is saved), and the contact and footer links with a ready message. The number comes from the business settings (local numbers like 0300… get 92); the buttons are hidden until a number is set
* [x] **admin redesign** after the deck: grouped sidebar (Shop / Content / Customers / Studio) with icons, the shop-name logo, number badges for orders to process, new messages and new custom requests (refreshed on every page change), a dashed "View shop" button and Log out; on phones it becomes a scrolling top bar. Overview (greeting, "orders are waiting for you" banner, three stat cards, recent orders as a table-style list, orders-by-status chips, running low), Orders (table-style rows: order, customer, amount, payment, status), Products (card grid with an "In shop" on/off switch that saves immediately, Hidden label, stock and Edit), and the same page-title style on every other admin page. Behaviour and permissions are unchanged
* [x] admin inner layouts after the deck: **order detail** (progress bar through Pending → Delivered or a "cancelled" note, Items card with totals, Payments card, and a right column with Actions, Customer and Delivery cards), **product form** (details card with category/price and availability/stock side by side; right column with pictures, show-in-shop and feature switches, Save, Cancel and Delete), **settings** (Shop details, Delivery and Social links cards), **messages** (avatar, quoted message bubble, pill reply buttons; WhatsApp reply now turns 0300… numbers into 92300…), **gallery** (on/off switches for "Shown publicly" and "Top of the home page"). All behaviour, permissions and texts used by the tests are unchanged
* [x] owner's list after the admin inner layouts: back links are now pill buttons with an arrow icon (shop and admin); a shared `FilePicker` (a real button instead of the browser's "Choose File") used for gallery, product and custom-order pictures; **pictures can be chosen while creating a product** (several at once, previews, removable; uploaded right after the product is saved, and if one fails the product still exists and a pop-up says how many failed); **pop-up messages (toasts)** replace inline success text (added to bag with a "View bag" link, wishlist saved/removed, account details saved, admin settings/product/gallery saved, product shown/hidden) while errors stay inside their forms; **admin Categories** open like an accordion to show each category's products with pictures (and "See all" links to the filtered product list); **order items show the product picture** (backend `image_url` on order items, live from the product; shown on the customer order and confirmation pages and in the admin order); the **admin address-changing function was removed** (UI, API route and tests; business-rules §16 updated); fixed a layout bug where the add-product page's right column ran off the screen (grid columns now `minmax(0, …)`)
* [x] **custom-order discussion and agreed price** (owner-approved design, business-rules §29): a Discussion (messages as bubbles, refresh button, composer) on the customer's request page `/custom-orders/:id` and on the admin's `/custom-orders/:id`; **the shop proposes a price and the customer confirms it in a pop-up; only that accepts the request** (the admin cannot accept a registered customer's request, a changed price is refused as "price changed"; guest requests are accepted by the admin at the price agreed on WhatsApp); guests have no discussion; the discussion closes when the request is finished; notifications and emails both ways (Resend needed for delivery); backend: table `custom_order_messages`, column `agreed_price_paisa`, routes for both sides, 30 messages/hour for customers (applied on Supabase)
* [x] **My orders list shows pictures** of what was ordered (up to three per order)
* [x] `python -m app.tools.check_services` (read-only checks of the database, migrations, pg_cron job, Supabase signing keys, Storage buckets and rules, admin two-factor setting and email provider; `--send-test` sends one real email). First run on the owner's project: database, migrations, expiry job and signing keys pass; the `custom-order-references` bucket does not exist yet and the other two buckets have no 5 MB / image-type limits (manual steps in the Supabase dashboard)
* [x] owner's follow-up: **Delete product** is a red button at the top right of the product page (above the pictures) and asks in a pop-up first; the gallery's Delete is a proper red button (same place) with a pop-up too (shared `ConfirmDialog`); the custom-order price now needs the customer's confirmation (see above; migration `custom order proposed price`)
* [x] owner's feedback after the first hands-on test: the customer can **decline** a proposed price or **offer a different price**; the admin **accepts the customer's offer** (pop-up) or proposes another price; every price step is also a line in the discussion; the reference picture is shown **as a picture** on the admin request page and in the admin list (still with the link); bigger pictures in the wishlist and bag panels (migration `custom order customer offer`, applied on Supabase)
* [x] **payment by transfer** (owner's decision: no gateway, business-rules §13 and database §30): checkout offers "Bank or wallet transfer" when the admin has written instructions (Settings -> Payment by transfer); the order page/confirmation shows the amount, the instructions and a form for a transaction number and/or a screenshot (private bucket `payment-proofs`); sending it stops the 30-minute clock; the admin sees the proof and chooses "Payment received" (Paid + Confirmed) or "Not received" (fresh 30 minutes), both with pop-ups; unanswered orders expire like online ones; refunds of a paid transfer are recorded by the admin (no provider). Backend: enum value, three proof columns, setting, expiry function, routes; `check_services` also checks the new bucket (migration applied on Supabase; **the `payment-proofs` bucket must be created by hand, see README**)
* [x] **expired-payment notices** (instead of n8n; business-rules §13, database §31): the customer (notification + email, guests by email) and the shop are told once when an unpaid online or transfer order expires, by a scheduled call to `POST /api/internal/expire-orders` (secret header `X-Cron-Secret`, setting `CRON_SECRET`; 404 when unset) that also runs the expiry function; migration `order expiry notices` (applied on Supabase). **Still to do by hand: set `CRON_SECRET` and schedule the call (README: "Tell customers when their payment window expires")**
* [x] **email through SMTP** (`EMAIL_PROVIDER=smtp`; for the no-domain case a dedicated Gmail with an App Password; stdlib only, TLS on 465 or STARTTLS otherwise, password never logged; README: "Email without a domain: Gmail through SMTP"). Correction to an earlier statement: sending *as* Gmail through a third-party service fails authentication, but sending through Gmail's own SMTP server works. Supabase's signup emails need the same SMTP settings entered in the Supabase dashboard (manual)
* [x] **quality-assurance phase** (docs/qa-report.md): the whole system was exercised in a real browser on a throw-away local database (about 140 live checks: visitor, customer, admin, business rules, security probes, accessibility in Chrome, expiry job). Six problems found and fixed (payment copy, wishlist button state, admin landmark and skip link, footer contrast, empty actions card, admin phone menu now slides in). Real-service checks (Supabase login/2FA, Storage uploads, email delivery, a real phone, the first deployment) are listed in the report for the owner to do
* [x] tests: 411 frontend, 530 backend

Not done yet:

* reviews, addresses and notifications keep the new colours, buttons and headers but have no individually designed layouts; custom orders, customers and categories (admin) only got the new page titles; quick view on cards; the "meet the maker" block of the home mockup; the admin's custom-orders, customers, categories and reviews pages keep their previous inner layouts under the new sidebar
* The deck also shows things that are not in the business rules and were NOT built: free delivery over Rs 3,000, 2–4 day delivery, 5–10 day making time, an About page, policy pages (shipping, returns, care, privacy, terms), a holiday mode, and an admin sidebar layout. Tell me which of these you confirm as rules.
* Deliberately NOT copied from the mockup because the business rules do not say so: "Free delivery over Rs 3,000", "Delivered in 2–4 days", a journal/articles section. (The newsletter was confirmed by the owner and is now a rule.) They can be added if the owner confirms them as rules.
* Known limits (speed): the database is hosted in Tokyo, so each query from Pakistan costs about 0.2–0.3 s. For development use the local Docker database; in production host the backend in the same region as the database (or move the Supabase project to Singapore or Mumbai before launch).
* **Email provider: Resend** (chosen by the owner). The adapter is built and tested against a mock transport (request shape, bearer key, refusals, network failure, settings validation, key never printed). **Not verified against the real service**: the owner must create an API key and set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM` in `backend/.env` (see README), and verify a domain before emails reach customers. The migration `create newsletter subscribers` is applied to the Supabase database.
* Not verified on the owner's own devices (checked with automated tests and Chrome screenshots at phone and desktop widths).

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

Status: **Implemented and tested against a fake gateway. The real gateway adapter is not built: the provider is still to be chosen (deferred by the owner).**

Tasks:

* [x] COD (`POST /api/admin/orders/{id}/confirm-cod-payment`: only after Delivered; COD Pending -> Paid)
* [ ] online payment provider selection — **open**: no real gateway chosen yet. Everything provider-independent is built behind `PaymentProvider` (`create_checkout`, `verify`, `parse_webhook`, `refund`); a real adapter implements those four calls once a gateway and its sandbox credentials exist.
* [x] payment initiation (`POST /api/orders/{id}/pay`, public for guests and customers; only inside the 30-minute window; returns the gateway redirect URL)
* [x] payment verification (state changes only from the provider's own answer; amount must match; the browser and webhook bodies are never trusted)
* [x] payment failure (attempt marked FAILED; the order is not cancelled; reservation kept)
* [x] retry payment (a new attempt row after a failed one; an earlier open attempt is settled first, so no double charging)
* [x] webhooks/callbacks (`POST /api/payments/webhook/{provider}`: signature checked, provider asked for the truth, 503 on provider outage so it retries; customer-return verification via `POST /api/orders/{id}/payment/refresh`)
* [x] idempotency (duplicate and simultaneous notifications harmless; refunds use idempotency keys)
* [x] refunds (`POST /api/admin/orders/{id}/refund`: cancelled paid online orders only, never more than owed = paid - charge - refunded; provider failure changes nothing)
* [x] partial refunds (PARTIALLY_REFUNDED / REFUNDED)

Implementation notes:

* Tests: backend 241 passing (adds 33 payment tests: initiation rules, success/failure/retry, webhook forgery and malformed requests, unknown reference, amount mismatch, provider outage, duplicate/concurrent webhooks, late payment before and after the expiry job, payment racing an admin cancel, refund rules/partial/failed/simultaneous, COD, authorization, unsafe configuration); frontend 86 passing (adds Pay now, payment return page, fake gateway page).
* The tests found and fixed: a timezone bug comparing the deadline with the database clock; and an earlier Phase 6 flaw where an order with only FAILED attempts could never expire (the expiry function now ignores failed attempts).
* A development simulator (`PAYMENT_PROVIDER=fake`, refused when `APP_ENV=production`) lets the whole online flow be tried locally: checkout with online payment -> fake gateway page -> return page. The simulator page is not in the production frontend bundle (verified) and its backend endpoint is only registered when the fake provider is configured. See `README.md`.
* Verified against Supabase: migration applied (`FAILED` status present, expiry function updated, dry run returned 0). Online payment stays switched off there (`ONLINE_PAYMENTS_ENABLED=false`, `PAYMENT_PROVIDER=none`).
* Decisions (documented in `business-rules.md` §13, §20–22 and `database.md` §3, §11, §27): one payments row per attempt; late payment keeps the order Cancelled and refundable in full; payment initiation is public by order id (guests); an attempt can start only after the previous one failed.
* Known gaps, left for later: no real gateway (and so no real signature scheme, refund API or sandbox testing); no rate limiting on the public pay/refresh/webhook routes (Phase 10); a duplicate payment from a second, unconfirmed attempt is not specially flagged; admin screens for refunds are Phase 9; customer notification emails are Phase 8.
* Not verified: the full online flow in a browser (use the fake gateway to try it).

---

## Phase 8 — Engagement

Status: **Implemented and tested. Not yet done: a real email provider (undecided), real Supabase Storage uploads (need the buckets and the service key), and NEW_PRODUCT notifications (moved to Phase 9).**

Tasks:

* [x] product reviews (`/api/products/{id}/reviews`: public list with average and count; the signed-in customer can post only after a Delivered order containing the product, once per product, rating 1–5; edit and delete own; admin list and removal; public shows first names only)
* [x] gallery (`/api/gallery` public, visible only, filter by type; admin upload via signed URL, register, edit, hide/show, delete with file cleanup; images start hidden)
* [x] custom orders (guest or customer submit with optional private reference image; customer list/detail/cancel while NEW or IN_DISCUSSION; admin list/search/filter, signed link to the private image, status transitions; rate limited)
* [x] contact messages (public form, at least one way to reply, rate limited; admin list/search/filter and status NEW/READ/REPLIED/ARCHIVED)
* [x] notifications (in-app, registered customers; list, unread count, mark one/all read; created in the same transaction as the event: order placed/confirmed/status changed/shipped/delivered, payment success/failure, custom-order updates)
* [~] transactional email — built behind an `EmailProvider` interface (`none` default, `console` development-only logger); emails are queued and sent only after the database commit succeeds, best-effort in the background. **Resend adapter added in the UI polish phase (needs the owner's key and sender; see README).** Customer emails for order and payment events (guests included), shop alerts to the business-settings email for new orders, custom orders and messages.

Implementation notes:

* Tests: backend 368 passing (adds notifications and emails, reviews, gallery, custom orders, contact, rate limiter, email outbox, private-bucket storage calls); frontend 116 passing (adds reviews section, gallery, custom order form and list, contact form, notifications page and link).
* Rate limiting: a small in-process sliding window per client IP (no Redis, per CLAUDE.md §2) protects guest custom-order submissions (5 per hour), their image uploads (10 per hour) and contact messages (5 per hour). It is per worker, and `TRUST_PROXY_HEADERS` must be set only behind a trusted proxy. Rate limiting of other routes stays in Phase 10.
* The private bucket: custom-order reference images are never public; the admin sees them only through short-lived signed download links.
* Bugs found by tests and fixed: the order email read "order NONE" because the id was not assigned before the email was built (now flushed first); notifications created in one transaction had identical timestamps so their order was arbitrary (`clock_timestamp()` default).
* Verified against Supabase: migration applied; the five new tables exist with RLS on.
* Decisions (documented in `business-rules.md` §26–31 and `database.md`): see "Decided (Phase 8)" above; additionally: a contact message needs an email, phone or WhatsApp number; gallery images start hidden; a customer may cancel a custom order only while NEW or IN_DISCUSSION; admin moves custom orders only along the allowed transitions; reading a message does not change its status.
* Setup needed on Supabase (README): buckets `gallery-images` (public) and `custom-order-references` (**private**), and `SUPABASE_SERVICE_KEY`. Without the key, upload endpoints return 503 and everything else works.
* Known gaps, left for later: automatic order expiry (the SQL job) does not send a notification or email; a custom order stores no email, so guests can only be contacted on WhatsApp; uploaded-but-never-submitted custom-order images are orphans (a cleanup job is Phase 10); no real email delivery; admin screens are Phase 9; the real Supabase Storage signed-upload/download request formats are tested only against a mock.
* Not verified: the new pages in a browser.

---

## Phase 9 — Admin Dashboard

Status: **Implemented and tested.** Not yet done: trying the screens in a browser against real data, and real picture uploads (they need the Storage buckets and key).

Tasks:

* [x] dashboard (`GET /api/admin/dashboard`; page `/admin`: orders needing action, orders by status, new messages and custom requests, products running low, recent orders)
* [x] product management (list with search/category filter, create, edit, show/hide, feature, delete with confirmation, picture upload/describe/remove; new guard: the availability type cannot change while orders containing the product are active)
* [x] category management (list with product counts, add, rename, delete; deleting a used category is blocked)
* [x] order management (list with filters/search; order page with one-step status changes, address change, payment attempts)
* [x] customer management (view only: list with search, details with counts and recent orders)
* [x] gallery management (upload, show/hide, change type, delete)
* [x] custom-order management (list/filter/search, private reference picture via signed link, status transitions)
* [x] message management (list/filter/search, status, reply by email or WhatsApp link)
* [x] business settings (`GET/PATCH /api/admin/settings`, public read `GET /api/settings`; exactly the fields in business-rules §33)
* [x] refund/cancellation management (from the order page: cancel with the Processing charge and waiver option, confirm cash received, full or partial refund)
* [x] NEW_PRODUCT notifications (moved here from Phase 8: in-app, to subscribed customers, when a product is published)
* [x] reviews moderation screen (list and remove)

Implementation notes:

* Tests: backend 401 passing (adds dashboard, customers, categories overview, settings validation and effects, availability-type guard, NEW_PRODUCT including a 50-customer bulk case); frontend 179 passing (adds the admin guard and every admin screen).
* The admin area is protected twice: the backend authorizes every `/api/admin/*` request (admin role from server-controlled metadata), and the frontend guard (`AdminRoute`) only decides what to show. A non-admin who opens `/admin` sees "No access" and no admin data is requested beyond the identity check.
* Bugs found by tests and fixed: publishing a product with two or more subscribed customers failed (the Python-side id default became one value shared by the whole `INSERT ... SELECT`; ids are now generated in SQL); admin lists flashed "Loading…" and lost their buttons on every reload (the loader now keeps the previous data during a plain reload).
* Money rule kept in the UI: prices and fees are typed in rupees, converted with string/integer parsing (`parseRupeesToPaisa`, `paisaToRupeesInput`), never floating point.
* Decisions (not in the rules, easy to change): "needs action" means Pending COD orders plus Confirmed orders; "running low" means 3 or fewer ready-to-ship pieces; the dashboard shows no sales totals (analytics are out of scope); NEW_PRODUCT is in-app only and repeats if a product is hidden and shown again.
* Not implemented, by decision or scope: holiday mode and payment-method switches (in the mockup, not in the rules); editing or deleting customers (the account-deletion strategy is an open decision); a "Recent activity" feed (needs an event log that is not in the database design); the mockup's "note from customer" on orders (no such field in the design).
* Admin access: log in as the admin account (created with the SQL in `README.md`) and open `/admin`; an "Admin" link appears on the home and account pages for that account only.

---

## Phase 10 — Hardening

Status: **Implemented and tested; four items remain unverified until deployment or real devices (marked `[~]`)**

Done so far — admin security (an architecture change explained and approved; `CLAUDE.md` §4 and §6 updated):

* [x] admin split into its own site: separate Vite app, development port 5174, own build (`dist/admin`), own domain in production; the shop build contains no admin code and the admin build contains no shop pages (checked by searching the bundles). The shop has no `/admin` page at all.
* [x] two-factor authentication for the admin: the backend requires Supabase assurance level `aal2` on every `/api/admin/*` route except `/api/admin/me` (a test walks the real route table, so a future admin route cannot forget it); the admin site has a login page, first-time authenticator setup (QR code and manual key) and a code step. `ADMIN_REQUIRE_MFA=false` is allowed for local development only; production refuses it.
* [x] audit log: `admin_audit_log` table (migration applied on Supabase), middleware recording data-changing admin requests and refused authenticated attempts (no request bodies, unauthenticated requests ignored, failures never break the request), `GET /api/admin/audit-log` and an Activity log screen.
* [x] CORS allows both origins; admin pages are not indexed (`noindex`); tests no longer depend on a developer's `.env`.

Tasks:

* [x] security review: all 81 API routes inventoried by protection level (39 admin, 1 admin identity, 25 customer, 2 optional-login, 14 public); secrets, CORS, error leakage and dependency audits checked (`npm audit` and `pip-audit`: 0 known vulnerabilities)
* [x] authorization review: admin routes covered by the route-table test; customer routes: every id lookup reachable by customers is owner-scoped or checked straight after loading, backed by the per-feature isolation tests
* [x] input validation review: a scan of every request model found every string and list length-capped and the one dictionary (social links) validated; unknown fields are rejected on all write models
* [~] file-upload security: server-generated paths, strict path pattern, image-type allowlist, rate-limited guest uploads, private bucket for custom-order pictures — all tested. **Not verified:** the actual bucket limits (5 MB, jpeg/png/webp) are manual Supabase settings that cannot be checked from here, and the server does not look at the uploaded file itself.
* [x] rate limiting: per-route limits on every public write (orders 10/h, quote 120/min, pay 20/h, payment refresh 60/min, DB health 30/min, plus the existing contact and custom-order limits) and a global backstop of 600 requests/min per client; webhooks, health and CORS preflight are exempt from the backstop
* [x] performance review: no N+1 (13 list endpoints guarded by a statement-count test); the admin custom-orders list signs picture links concurrently (6 pictures in about 0.2 s, not 1.2 s)
* [x] database indexes: all foreign keys indexed (checked in the database); trigram search index deliberately deferred
* [x] N+1 review (see above)
* [x] accessibility review: axe-core runs on 34 real pages of both sites (0 violations; the checker is proven to catch problems) and a colour-contrast test reads the real colour tokens; it found and fixed one failure ("No image" tiles, 4.28:1, now AA)
* [~] responsive review: the owner's phone-size check found a real bug (the home page's link row could not wrap and "Create account" ran off the screen); 24 rows of links/buttons across the shop and admin could not wrap and now do, and a test scans the source so a non-wrapping row cannot return. Headless Chrome screenshots at 360 px confirmed the home, shop and contact pages. **Not yet checked at phone size: the signed-in shop pages and the admin screens.**
* [x] automated tests (backend 430, frontend 259; new suites for HTTP safety, query counts, accessibility, contrast and deployment headers)
* [x] error handling: any unexpected error returns a generic JSON 500 with a request id (traceback only in the server log), still readable by the browser (CORS headers present)
* [x] logging: one line per request with an id (no query strings), `X-Request-ID` header, log level setting, app log lines visible under uvicorn
* [x] backup/recovery documentation: `README.md`; the dump/restore procedure was run and verified on the local database
* [~] deployment configuration: two Vercel configs with strict security headers (`deploy/shop`, `deploy/admin`, checked by tests), production environment checklist, startup warning for the proxy setting. **Not verified:** nothing has been deployed; the Vercel root-directory build, the `API_DOMAIN` placeholder and the content security policy against the live pages must be checked on the first deployment. No domain is chosen yet (decided later).

Also added to every API response: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, a locked-down content security policy, `Cache-Control: no-store` on private or data-changing responses, and HSTS in production.

Implementation notes (admin security):

* Tests: backend 417 passing (adds the MFA rules, the whole-route-table MFA test, forged `user_metadata` claims, CORS origins, the audit log); frontend 194 passing (adds the admin guard states, login, MFA setup/verify, activity log, and "each app has none of the other's pages").
* Bugs found and fixed while doing this: the admin dev page loaded its script through a relative path that the dev server answered with HTML (fixed with a root entry file); tests had read the developer's own `.env` (now pinned in `conftest.py`).
* Not verified: the real Supabase MFA calls (enrolling and verifying an authenticator code) against your project; they are tested only against mocks. Supabase's TOTP MFA must be enabled in the project settings (Authentication → Multi-Factor).
* Known limits: the in-process rate limiter is per worker; an IP allowlist for the admin site is possible later (at the host or in the API); the audit table can still be changed by someone with database access.

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
