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
