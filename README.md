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

## Product image storage (one-time setup)

1. Supabase dashboard -> Storage -> New bucket: name `product-images`, **public**, file size limit
   5 MB, allowed MIME types `image/jpeg, image/png, image/webp` (the bucket enforces these).
2. Supabase dashboard -> Settings -> API Keys: copy the **secret** key into `backend/.env` as
   `SUPABASE_SERVICE_KEY`. It is server-only: never put it in a `VITE_*` variable or commit it.
   Without it, image upload endpoints return 503 and everything else still works.

## Tests

Backend database tests need the local Docker Postgres (`make db`); they use a separate
`crochet_test` database and are skipped if it is unavailable.
