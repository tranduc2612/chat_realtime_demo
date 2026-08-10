# Chat Realtime Demo

![CI/CD](https://github.com/tranduc2612/chat_realtime_demo/actions/workflows/ci-cd.yml/badge.svg)

A full-stack realtime chat application — FastAPI + React + WebSockets over Redis Pub/Sub, horizontally scaled behind an nginx load balancer, with three independent, versioned environments (dev/staging/prod) and Sentry error tracking baked in.

Built as a hands-on demo of a realistic, horizontally-scalable chat backend: direct messages, group conversations, live delivery across multiple backend replicas, unread/read-receipt tracking — not just a toy single-process WebSocket echo server.

## Features

- JWT auth (register/login), user search
- Direct messages and group conversations, with add-member support
- Realtime message delivery over WebSockets — works correctly even when two users' connections land on *different* backend replicas
- Unread counts / read receipts, paginated message history
- Dark/light theme
- Message attachments (image/video/file/mixed)

## Architecture

```
Browser ──HTTP/WS──▶ nginx (Layer 7, round-robin, :8000/8080/9000)
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
         backend-a    backend-b    backend-c   (FastAPI, 3 replicas)
              │           │           │
              └─────┬─────┴─────┬─────┘
                     ▼           ▼
                  MySQL        Redis  ◀── Pub/Sub backbone for WebSocket broadcast
```

The interesting part: a message sent by a client connected to `backend-b` has to reach a client connected to `backend-a`. Each backend process publishes new-message events to a Redis channel instead of writing to its own in-memory socket registry directly; every replica subscribes to that channel and delivers to whichever locally-connected sockets match. That's what makes load-balancing WebSocket traffic across replicas actually work, rather than silently dropping messages between users who land on different backends. See `chat_with_fastapi/README.md`'s "Realtime architecture" section for the full breakdown.

## Tech stack

| | |
|---|---|
| **Backend** | FastAPI · SQLAlchemy 2.0 (async, `aiomysql`) · MySQL · Redis (Pub/Sub) · Alembic · JWT (`python-jose`) · bcrypt · Sentry |
| **Frontend** | React 19 · TypeScript · Vite · Tailwind CSS v4 · Zustand · Axios · React Router v7 · Sentry |
| **Load balancer** | nginx (Layer 7, round-robin + passive health checks) |
| **Testing** | pytest (backend, mocked DB) · Vitest + Testing Library (frontend) · Playwright (e2e, drives the real stack) |
| **CI/CD** | GitHub Actions — test on every PR, build & publish versioned images to GHCR on merge to `main` |

## Quick start

Requires Docker.

```bash
git clone https://github.com/tranduc2612/chat_realtime_demo.git
cd chat_realtime_demo
make dev            # or: docker compose up
```

- App: **http://localhost:5173**
- API docs (Swagger): **http://localhost:8000/api/v1/docs**

That single command brings up MySQL, Redis, runs migrations, starts three load-balanced backend replicas, and the frontend dev server — nothing else to install locally.

## Running without Docker

For local development on the backend or frontend directly — no load balancer, no multiple replicas, just one backend process talking straight to the frontend.

**Prerequisites:** Python 3.12, Node 22, a running MySQL server, and a running Redis server (`brew install mysql redis && brew services start mysql redis` on macOS — Redis is not optional, the backend won't start without one reachable).

**1. Backend** (`chat_with_fastapi/`)

```bash
cd chat_with_fastapi
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env: set DATABASE_URL/DATABASE_SYNC_URL to a MySQL user/db you have
# (create the database first, e.g. `mysql -u root -p -e "CREATE DATABASE chat_realtime_demo"`)

alembic upgrade head        # or: python -m app.init_data (fresh throwaway DB, skips migrations)
make dev                    # == uvicorn app.main:app --reload
```

Backend is now at **http://127.0.0.1:8000** (docs at `/api/v1/docs`).

**2. Frontend** (`chat_frontend/`, separate terminal)

```bash
cd chat_frontend
npm install

cp .env.sample .env
# edit .env:
#   VITE_API_URL=http://localhost:8000/api/v1
#   VITE_WS_URL=ws://localhost:8000/api/v1

npm run dev
```

Frontend is now at **http://localhost:5173**, talking directly to the backend on :8000.

See [`chat_with_fastapi/README.md`](chat_with_fastapi/README.md) for the full backend setup (Sentry env vars, Windows notes, migration commands) — this is the condensed version.

## Environments

Dev, staging, and production are three independent, identically-shaped stacks, each on its own port range so **all three can run at once** on one machine:

| Env | Command | App | API | Notes |
|---|---|---|---|---|
| dev | `make dev` | :5173 | :8000 | hot reload, DB/Redis ports exposed |
| staging | `make staging` | :5174 | :8080 | real production build, needs `.env.staging` |
| prod | `make prod` | :5175 | :9000 | real production build, needs `.env.prod` |

First-time staging/prod setup: `cp .env.staging.example .env.staging` (and same for prod), then fill in real secrets — the committed dev `.env` works as-is.

The app version is a single source of truth: the root `VERSION` file. It flows into every environment's Docker image tag and into the backend's `APP_VERSION` (visible live in Swagger and tagged on every Sentry event). Bump `VERSION`, rerun `make <env>` — that's the whole release process.

## Project structure

```
chat_realtime_demo/
├── chat_with_fastapi/   # Python backend — see its README for API/architecture details
├── chat_frontend/       # React frontend
├── e2e/                 # Playwright end-to-end tests, drives the real stack
├── nginx/nginx.conf     # Load balancer config, shared by all three environments
├── .github/workflows/   # CI/CD (GitHub Actions)
├── VERSION               # single source of truth for the app version
├── Makefile               # make dev / staging / prod
├── docker-compose.yml            # dev
├── docker-compose.staging.yml    # staging
└── docker-compose.prod.yml       # production
```

## Testing

```bash
# Backend unit tests (mocked DB, no MySQL/Redis needed)
cd chat_with_fastapi && make test

# Frontend unit tests
cd chat_frontend && npm run test

# End-to-end (spins up the real stack via docker compose)
cd e2e && npm run test
```

All three run automatically in CI on every pull request.

## Error tracking

Sentry is wired into both backend and frontend, gated entirely on a `SENTRY_DSN`/`VITE_SENTRY_DSN` env var being set — unset (dev's default) means it's fully off, no code path taken, nothing reported. Staging and prod have it configured by default once you fill in `.env.staging`/`.env.prod`.

## More detail

- [`chat_with_fastapi/README.md`](chat_with_fastapi/README.md) — backend setup, API routes, data model, realtime architecture
- [`CLAUDE.md`](CLAUDE.md) — full developer/architecture reference (routes, layer conventions, env vars, everything)
