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

Status: **Complete — verified locally** (Supabase connection not yet exercised; see notes)

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
* Not yet verified: connecting to a Supabase-hosted database (needs the project's connection string; mind the pooler / asyncpg prepared-statement settings when we do).
* Not implemented (belongs to later phases): any tables, authentication, rate limiting, CI pipeline.

---

## Phase 2 — Authentication

Status: Not Started

Tasks:

* Supabase Auth integration
* customer authentication
* customer profile
* authentication dependency
* admin authorization
* protected routes
* customer-only data access
* admin-only data access

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
