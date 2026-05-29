---
name: fastapi-postgres
description: Scaffold a minimal FastAPI service with PostgreSQL, SQLAlchemy, and local Docker Compose
---

# FastAPI + PostgreSQL

Use when the user wants a REST API backed by Postgres.

## Steps

1. Confirm entities and CRUD scope; default to one resource if unclear.
2. Generate `requirements.txt` with pinned major versions: `fastapi`, `uvicorn[standard]`, `sqlalchemy`, driver (`asyncpg` or `psycopg[binary]`), `alembic` if migrations.
3. Add `app/config.py` reading `DATABASE_URL` from the environment.
4. Add `app/db.py` with engine, session factory, and `get_db` dependency.
5. Add SQLAlchemy models under `app/models/` and Pydantic schemas under `app/schemas/`.
6. Add routers under `app/routers/` and include them in `app/main.py`.
7. Add `docker-compose.yml` with `postgres:16` and the API service; wire `DATABASE_URL`.
8. Add `tests/test_health.py` and at least one API test using `TestClient` and a test DB strategy (SQLite in-memory only if user allows; otherwise document pytest + compose).
9. Write `README.md` with setup, migrate, run, and test commands.

## Quality bar

- Idempotent migrations or documented schema bootstrap.
- Foreign keys and `ondelete` behavior stated in models.
- 422 responses from Pydantic validation, not hand-rolled JSON errors.
