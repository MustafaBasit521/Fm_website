.PHONY: db db-down backend frontend migrate test lint format check

db:        ## start local dev Postgres (docker)
	docker compose up -d db
db-down:
	docker compose down
backend:   ## run API on :8000
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
frontend:  ## run Vite on :5173
	cd frontend && npm run dev
migrate:   ## apply Alembic migrations
	cd backend && .venv/bin/alembic upgrade head
test:
	cd backend && .venv/bin/pytest -q
	cd frontend && npm test
lint:
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd frontend && npm run lint && npm run format:check
format:
	cd backend && .venv/bin/ruff check --fix . && .venv/bin/ruff format .
	cd frontend && npm run format
check: lint test  ## everything CI would run
	cd frontend && npm run build
