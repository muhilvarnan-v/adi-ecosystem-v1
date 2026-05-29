# AID

Phase 1: **Goals** and **Integrations** (Jira + Trello) with FastAPI, React + Vite, and Firestore.

AI-powered scope implementation is planned for a later phase and is not included here.

## Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Backend  | FastAPI                             |
| Frontend | React + Vite + TypeScript           |
| Database | Google Cloud Firestore              |
| Auth     | `X-User-Id` header (temporary)      |
| Jira     | Atlassian OAuth 2.0 (3-legged)      |
| Trello   | OAuth 1.0a (Trello’s user-auth API) |

## Project structure

```
AID/
├── backend/          # FastAPI API
├── frontend/         # React app
└── README.md
```

## Prerequisites

- Python 3.11+
- Node.js 18+
- GCP project with Firestore enabled
- Service account JSON with Firestore access (or Application Default Credentials)

## Firestore setup

1. Enable Firestore in Native mode in your GCP project.
2. Set `GOOGLE_APPLICATION_CREDENTIALS` to your service account key path, or use `gcloud auth application-default login`.
3. Set `FIRESTORE_PROJECT_ID` in `backend/.env`.

Create a composite index for goals listing (Firestore will also prompt via error link on first run):

- Collection: `goals`
- Fields: `user_id` Ascending, `created_at` Descending

## Run both (from repo root)

After one-time setup below:

```bash
npm install          # root (concurrently) + installs dev runner only
cd frontend && npm install && cd ..
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cd ..
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

npm run dev          # starts backend :8000 and frontend :5173
```

- API: http://localhost:8000/docs  
- App: http://localhost:5173  

The Vite dev server proxies `/api` to the backend.

## Backend setup

Use **Python 3.11–3.13**. The default `python3` on Homebrew may be 3.14, which fails to build older `pydantic-core` wheels.

From the repo root (recommended):

```bash
npm run setup:backend
cp backend/.env.example backend/.env
```

Or manually:

```bash
cd backend
python3.13 -m venv .venv    # or python3.12 / python3.11
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

If you already created a `.venv` with Python 3.14, delete it and re-run `npm run setup:backend`.

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## OAuth configuration

### Jira (OAuth 2.0)

1. Create an OAuth 2.0 (3LO) app at [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/).
2. Set callback URL: `http://localhost:8000/api/integrations/jira/callback`
3. Add scopes: `read:jira-work`, `write:jira-work`, `offline_access`
4. Set `JIRA_CLIENT_ID` and `JIRA_CLIENT_SECRET` in `backend/.env`

### Trello (OAuth 1.0a)

1. Get API key and secret from [Trello Power-Ups admin](https://trello.com/power-ups/admin).
2. Set OAuth callback URL: `http://localhost:8000/api/integrations/trello/callback`
3. Set `TRELLO_API_KEY` and `TRELLO_API_SECRET` in `backend/.env`

### GitHub (OAuth 2.0)

1. Create an OAuth App at [GitHub Developer settings](https://github.com/settings/developers) (OAuth Apps → New).
2. Set **Authorization callback URL**: `http://localhost:8000/api/integrations/github/callback`
3. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `backend/.env`
4. In the app, open **Harness → Integrations** and connect GitHub. Then link a repository on an application.

## API overview

### Goals

| Method | Path                    | Description              |
|--------|-------------------------|--------------------------|
| GET    | `/api/goals`            | List goals               |
| POST   | `/api/goals`            | Create manual goal       |
| POST   | `/api/goals/from/jira`  | Create from Jira issue   |
| POST   | `/api/goals/from/trello`| Create from Trello card  |
| PATCH  | `/api/goals/{id}`       | Update goal              |
| DELETE | `/api/goals/{id}`       | Delete goal              |

All routes require header: `X-User-Id: <stable-user-id>` (the frontend generates one in `localStorage`).

### Integrations

| Method | Path                              | Description        |
|--------|-----------------------------------|--------------------|
| GET    | `/api/integrations`               | List status        |
| GET    | `/api/integrations/jira/authorize`  | Start Jira OAuth   |
| GET    | `/api/integrations/trello/authorize`| Start Trello OAuth |
| GET    | `/api/integrations/jira/issues`   | Browse Jira issues |
| GET    | `/api/integrations/trello/cards`  | Browse Trello cards|
| GET    | `/api/integrations/github/authorize`| Start GitHub OAuth |
| GET    | `/api/integrations/github/repos`  | List accessible repos |
| DELETE | `/api/integrations/{provider}`    | Disconnect         |

## User identity (phase 1)

There is no full login yet. The frontend stores a random UUID in `localStorage` and sends it as `X-User-Id`. Replace this with real authentication in a later phase.

## Next phases

- User authentication (replace `X-User-Id`)
- AI tool to implement goal scope
- Redis for OAuth state in production
