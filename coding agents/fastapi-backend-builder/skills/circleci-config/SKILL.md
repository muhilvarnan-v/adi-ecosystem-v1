---
name: circleci-config
description: Author CircleCI 2.1 workflows for Python FastAPI projects
---

# CircleCI for FastAPI

Use when the user wants CI/CD or mentions CircleCI.

## Steps

1. Inspect the repo layout (or planned layout) under `/workspace/output/`.
2. Create `.circleci/config.yml` using version `2.1`.
3. Define an executor (`docker` + `cimg/python:3.12`) and reusable commands for install and test.
4. Workflow (minimum):
   - **lint**: install deps, run `ruff check .` or `flake8` if ruff is not in requirements.
   - **test**: install deps, run `pytest` with `PYTHONPATH=.` or package root as needed.
5. If `docker-compose.yml` exists and tests need Postgres, add a `docker` job step or `circleci/postgres:16` service with `POSTGRES_USER`, `POSTGRES_DB`, and `DATABASE_URL` for tests.
6. Optionally add **build** job using `setup_remote_docker` and `docker build` when a `Dockerfile` exists.

## Snippet patterns

- `working_directory: ~/project` with checkout at repo root.
- `store_test_results` / `store_artifacts` for `pytest --junitxml=reports/junit.xml` when tests exist.
- Branch filters only when the user names branches (e.g. `main` only).

## Output

- Print the final `config.yml` path and how to validate locally with the CircleCI CLI (`circleci config validate`) if available.
