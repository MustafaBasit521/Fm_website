import os

# Tests must never depend on a developer's real .env or hit a real database
# unless explicitly requested.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5433/test")
