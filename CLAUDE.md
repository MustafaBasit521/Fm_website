# Crochet Shop — Project Instructions

## 1. Project Overview

This project is a production-oriented e-commerce website for a small crochet business.

The system has two major areas:

1. Public/customer-facing storefront
2. Private admin dashboard

The initial MVP should be simple, maintainable, secure, and appropriate for a small business.

Do not introduce unnecessary infrastructure or complexity.

Project documentation:

* `docs/business-rules.md` — the **authoritative source for business behavior**
* `docs/database.md` — the **authoritative source for database design, constraints, enums and foreign-key behavior**
* `docs/progress.md` — current documentation/implementation progress

Read those documents before implementing features that depend on their contents.

Follow those documents. Do not invent behavior that conflicts with them. If a request or implementation detail conflicts with them, identify the conflict before proceeding.

---

# 2. Development Philosophy

Build the system as a **modular monolith**.

Prioritize:

* correctness
* security
* maintainability
* understandable code
* data integrity
* good user experience
* appropriate testing
* simple architecture

Do not prematurely introduce:

* microservices
* Kubernetes
* Redis
* message brokers
* distributed systems
* complex caching
* unnecessary abstractions
* unnecessary AI/ML systems

Add infrastructure or technologies only when a concrete requirement justifies it.

Preserve the modular-monolith architecture.

## Backend authority

The backend is authoritative for:

* security
* validation
* pricing
* inventory
* payment verification
* business rules

The frontend may display these, but never decides them.

---

# 3. Technology Stack

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
* Async SQLAlchemy
* asyncpg
* Alembic

## Database

* PostgreSQL
* Supabase-hosted PostgreSQL

## Authentication

* Supabase Auth

## Storage

* Supabase Storage

## Testing

Frontend:

* Vitest

Backend:

* pytest

## Code Quality

Backend:

* Ruff

Frontend:

* ESLint
* Prettier

## Payments

Support:

* Cash on Delivery
* Online payment through a Pakistani payment gateway

The exact payment provider should be selected and documented before provider-specific implementation.

## Email

Use an external transactional email provider.

The provider should be selected before implementation.

---

# 4. Architecture

High-level architecture:

Customer/Admin
↓
React + TypeScript + Vite
↓
FastAPI REST API
↓
Service Layer
↓
SQLAlchemy
↓
PostgreSQL / Supabase

Supporting services:

* Supabase Auth
* Supabase Storage
* External Payment Gateway
* External Email Service

The backend should remain reasonably stateless.

Persistent application state belongs in:

* PostgreSQL
* Supabase Storage
* Supabase Auth

---

# 5. Backend Architecture

Use this general layering:

Router → Service → Data Access / Database

## Router

Responsible for:

* HTTP requests
* request parsing
* authentication dependencies
* authorization dependencies
* response models
* HTTP status codes

Avoid putting large business workflows inside route handlers.

## Service

Responsible for:

* business rules
* workflows
* validation involving multiple entities
* transactions
* inventory handling
* order creation
* payment workflows
* cancellation/refund logic

## Data Access

Responsible for:

* database queries
* persistence
* loading entities
* updates
* deletes

Keep database logic separate from HTTP concerns.

---

# 6. Authentication and Authorization

Supabase Auth handles authentication.

The application's `customer_id` should correspond to the Supabase Auth user ID.

The application must never store user passwords.

Authorization must be enforced server-side.

Frontend route protection is only a UX feature and must never be considered a security boundary.

Customer users may access only their own private data.

Admin users may access admin functionality.

The initial system has one admin.

Admin authorization must use a server-controlled mechanism such as Supabase `app_metadata` or another server-controlled role mechanism.

Do not use user-editable metadata for authorization.

If FastAPI uses privileged database credentials, explicitly enforce application authorization because privileged database access must not be assumed to provide normal user-level RLS protection automatically.

---

# 7. Database Principles

Use PostgreSQL constraints wherever appropriate.

Important rules:

* use foreign keys
* use unique constraints
* use check constraints
* use indexes based on real query patterns
* use transactions for multi-step business operations
* use integer minor currency units
* never use floating-point values for money

Example:

Rs 1250.50 → `125050` paisa

Do not silently change the currency representation.

---

# 8. API Principles

Use REST APIs.

Examples:

* `GET /api/products`
* `GET /api/products/{id}`
* `POST /api/products`
* `PATCH /api/products/{id}`
* `DELETE /api/products/{id}`
* `GET /api/customers/me`
* `PATCH /api/customers/me`
* `/api/customers/me/addresses`
* `/api/orders`
* `/api/admin/...`

Exact endpoint structure may evolve during implementation, but maintain consistent REST conventions.

Use Pydantic request and response models.

Do not expose database models directly when a dedicated API schema is more appropriate.

---

# 9. Security Principles

Always consider:

* authentication
* authorization
* input validation
* SQL injection prevention
* XSS prevention
* CSRF considerations where applicable
* secure file uploads
* rate limiting on abuse-prone endpoints
* payment verification
* webhook validation
* secret management
* safe error messages
* HTTPS in production

Never commit:

* API keys
* database passwords
* Supabase service-role keys
* payment secrets
* email provider secrets
* other credentials

Never expose server secrets to the frontend.

Production errors should not expose stack traces or sensitive implementation details.

---

# 10. File Uploads

Product and gallery images should be stored in Supabase Storage.

Do not unnecessarily stream large image files through FastAPI.

Upload flow for product and gallery images:

1. An authenticated admin request reaches FastAPI.
2. FastAPI authorizes the admin.
3. FastAPI issues a signed upload URL.
4. The browser uploads the file directly to Supabase Storage.
5. The metadata/storage path is then persisted through the backend.
6. Supabase Storage bucket rules enforce allowed MIME types and maximum file size.

Guest custom-order reference images:

* use rate limiting/abuse protection
* keep the existing custom-order workflow (`docs/business-rules.md`)

Validate:

* file type
* file size
* allowed formats
* ownership/authorization

Store metadata/reference paths in PostgreSQL.

---

# 11. Frontend Principles

Use:

* TypeScript
* reusable React components
* semantic HTML
* accessible forms
* clear loading states
* clear empty states
* clear error states
* responsive layouts
* mobile-first public pages

Avoid unnecessary global state.

Keep API calls organized rather than scattering raw requests throughout components.

Do not duplicate business rules in multiple frontend components.

The backend remains authoritative.

---

# 12. Business Rules

The complete business rules are documented in:

`docs/business-rules.md`

When implementing a feature, consult that document rather than inventing new business behavior.

If implementation reveals an ambiguity:

1. identify the ambiguity
2. explain the impact
3. propose reasonable options
4. ask for a decision if it materially affects architecture or business behavior
5. document the final decision

Do not silently invent important business rules.

---

# 13. Database Rules

The conceptual schema is documented in:

`docs/database.md`

Before creating or modifying tables:

* understand existing relationships
* check foreign-key behavior
* consider historical data
* consider deletion behavior
* consider indexes
* consider constraints
* consider migrations

Never modify the database structure casually.

Every schema change should have an appropriate Alembic migration.

---

# 14. Orders and Payments

Order creation, inventory reservation, payment state, cancellation, and refunds are data-integrity-sensitive operations.

Use database transactions where required.

The frontend total is never authoritative.

The backend must recalculate and validate:

* product availability
* price
* quantity
* stock
* made-to-order capacity
* delivery fee
* final total
* delivery location

Payment provider responses must be verified by the backend.

Payment webhooks/callbacks should be handled safely and idempotently where appropriate.

---

# 15. Online Payment Window

The online payment flow (30-minute payment window, retries, automatic cancellation on expiry, reservation and release) is defined in `docs/business-rules.md` §13 and §19–§20.

Follow that document exactly. Do not reimplement this logic differently in different places.

---

# 16. Testing

Important business logic must have automated tests.

Backend tests should cover, where applicable:

* authentication/authorization
* product availability
* inventory
* made-to-order capacity
* checkout validation
* order creation
* order status transitions
* cancellation
* payment state transitions
* refunds
* Lahore-only delivery
* wishlist uniqueness
* review eligibility

Frontend tests should cover important user interactions and critical UI behavior.

Do not aim for meaningless 100% coverage.

Prioritize business-critical behavior.

---

# 17. Error Handling

Use predictable API error responses.

Errors should:

* be understandable
* use appropriate HTTP status codes
* avoid exposing sensitive details
* distinguish validation errors from authorization errors
* provide useful information for frontend handling

Do not silently swallow exceptions.

Log useful technical information server-side without logging secrets or unnecessary sensitive data.

---

# 18. Performance

For MVP:

* paginate large lists
* optimize images
* avoid N+1 database queries
* select only necessary data where appropriate
* add indexes based on actual query patterns
* avoid unnecessary API requests
* avoid unnecessary React re-renders
* keep mobile usage in mind

Do not prematurely optimize without evidence.

---

# 19. Accessibility

Follow practical WCAG-aligned practices.

Use:

* semantic HTML
* labels for form fields
* keyboard accessibility
* visible focus states
* meaningful alt text
* accessible validation messages
* sufficient contrast
* non-color-only status indicators

Do not claim WCAG AAA compliance unless formally verified.

---

# 20. Development Workflow

For every meaningful feature:

1. Understand the requirement.
2. Identify affected architecture/components.
3. Explain the approach.
4. Identify important concepts.
5. Implement.
6. Explain important code.
7. Connect implementation back to the architecture.
8. Test.
9. Review.
10. Update documentation/progress when appropriate.

For suitable learning features, do not immediately provide the complete solution.

Instead:

1. explain the concept
2. give the task
3. provide hints if needed
4. let the developer attempt it
5. review the attempt
6. improve the implementation

For large, repetitive, security-sensitive, or time-critical work, implementation may be done directly, but the important code and decisions must still be explained.

The goal is progressive independence, not dependency on the AI.

---

# 21. Teaching Style

Act as:

* senior developer
* coding mentor
* pair programmer
* architecture teacher
* code reviewer

Preferred explanation structure:

Real-world problem
→ intuition
→ simple example
→ technical explanation
→ code
→ project connection
→ exercise/task

Avoid explaining every trivial line.

Focus explanations on:

* why
* architecture
* trade-offs
* important implementation details
* common mistakes
* security implications

---

# 22. Debugging Workflow

When debugging:

1. Describe the symptom.
2. Identify possible causes.
3. Diagnose systematically.
4. Find the root cause.
5. Fix it.
6. Explain why it happened.
7. Explain how to prevent similar problems.

Do not randomly change code until the error disappears.

---

# 23. Architectural Changes

Before making a significant architectural change, explain:

* current approach
* problem with current approach
* proposed approach
* benefits
* costs/trade-offs
* alternatives considered
* reason for choosing it

Avoid architecture changes merely because a different technology is popular.

---

# 24. Documentation

Maintain:

`docs/business-rules.md`

for business workflows and decisions.

Maintain:

`docs/database.md`

for database structure and relationships.

Maintain:

`docs/progress.md`

for implementation progress and current project state.

`progress.md` is not a permanent instruction file. It should evolve as development progresses.

Keep `CLAUDE.md` focused on project-wide instructions rather than duplicating every database column or business rule.

---

# 25. Definition of Done

A feature is not considered complete merely because the UI works.

Where applicable, completion means:

* frontend implemented
* backend implemented
* authorization considered
* validation implemented
* database behavior correct
* migrations created
* business rules enforced server-side
* important tests added
* error/loading/empty states handled
* security considered
* documentation updated
* implementation reviewed

---

# 26. Current Implementation Priority

Implement in this order unless a documented reason requires otherwise:

1. Foundation
2. Authentication
3. Catalog
4. Customer profile/addresses/wishlist
5. Cart and checkout
6. Orders
7. Payments
8. Reviews/gallery/custom orders/contact/notifications
9. Admin dashboard
10. Security/performance/accessibility/testing/deployment hardening

Do not jump ahead unnecessarily.

---

# 27. Important Scope Boundary

The following are intentionally NOT part of the current MVP:

* AI chatbot
* recommendation engine
* WhatsApp automation
* loyalty system
* coupons
* gift cards
* analytics platform
* abandoned-cart system
* multilingual support
* multi-currency
* outside-Lahore delivery
* multiple admin roles
* microservices
* Kubernetes
* Redis
* message brokers

These may be considered later when there is a concrete requirement.

---

# 28. Final Principle

Build the simplest architecture that correctly solves the current business problem.

Prefer:

clear code > clever code

correctness > unnecessary abstraction

security > convenience

maintainability > premature optimization

learning > blind code generation
