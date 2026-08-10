# Chat Realtime — Backend (FastAPI)

Python backend for a realtime chat app: FastAPI + SQLAlchemy (async) + MySQL + Alembic + JWT auth + WebSocket messaging over Redis Pub/Sub.

## Stack

- **FastAPI** — HTTP + WebSocket API
- **SQLAlchemy 2.0** (async, `aiomysql`) — ORM
- **MySQL** — database
- **Redis** — Pub/Sub backbone for WebSocket broadcast (`app/core/websocket.py`)
- **Alembic** — schema migrations
- **python-jose** + **bcrypt** — JWT auth & password hashing

## Setup

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

You also need a **Redis server running locally** (required at app startup — the WebSocket connection manager publishes/subscribes through it):

```bash
brew install redis      # macOS
brew services start redis
# or just run it in a terminal: redis-server
```

Copy `.env.example` to `.env` and fill in your database credentials:

```
APP_NAME=API_CHAT_REALTIME
APP_VERSION=1.0.0
API_PREFIX=/api/v1

DATABASE_URL=mysql+aiomysql://root:YOUR_PASSWORD@localhost:3306/YOUR_DATABASE_NAME
DATABASE_SYNC_URL=mysql+pymysql://root:YOUR_PASSWORD@localhost:3306/YOUR_DATABASE_NAME
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=your-secret-key
```

`DATABASE_URL` (async) is used at runtime; `DATABASE_SYNC_URL` (sync) is used by Alembic. `REDIS_URL` defaults to `redis://localhost:6379/0` if unset.

Sentry is optional and off by default — set `SENTRY_DSN` to turn it on (see `.env.example`). With no DSN, `sentry_sdk.init()` never runs and nothing changes about how the app behaves.

Create the database schema — either run migrations:

```bash
alembic upgrade head
```

or, for a fresh throwaway DB, create tables directly from the models:

```bash
python -m app.init_data
```

## Running the server

```bash
make dev
# equivalent to: uvicorn app.main:app --reload
```

The API is served at `http://127.0.0.1:8000`, mounted under `/api/v1`.

- Swagger docs: `http://127.0.0.1:8000/api/v1/docs`
- ReDoc: `http://127.0.0.1:8000/api/v1/redoc`

## Running with Docker

The repo root (`chat_realtime_demo/`) has three environments — dev, staging, production — each a full stack (MySQL, Redis, a one-shot `migrate` service, this backend as 3 replicas behind nginx, and the frontend), each on its own port range so all three can run at once:

```bash
cd ..              # repo root, alongside chat_frontend/
make dev           # :8000 backend / :5173 frontend — bind-mounted source, --reload
make staging       # :8080 backend / :5174 frontend — real build, needs .env.staging first
make prod          # :9000 backend / :5175 frontend — real build, needs .env.prod first
```

`make dev` is equivalent to (and interchangeable with) running `cd .. && docker compose up` directly — that's what `e2e/` uses. Staging/prod need a one-time setup step: `cp .env.staging.example .env.staging` (and the same for prod), then fill in real values — the placeholder `.example` values are not safe to run with as-is. `make {dev,staging,prod}-down` tears down the corresponding environment only.

Only dev builds with source bind-mounted and `uvicorn --reload`; staging/prod run whatever's baked into the image at build time (closer to a real release artifact), and the frontend runs an actual `vite build && vite preview` there instead of the dev server. `nginx` is the only container publishing its environment's backend port to the host in every case — the three backend replicas are internal-only, reachable only through nginx's `upstream backend_pool` (`nginx/nginx.conf`, shared across all three environments, `least_conn` + passive health checks). Response header `X-Upstream-Addr` shows which replica handled a request. This is why the Redis Pub/Sub design in [Realtime architecture](#realtime-architecture-redis-pubsub) matters: two clients can land on two different replicas behind the load balancer and still see each other's messages live.

**Versioning:** the root `VERSION` file (e.g. `1.0.0`) is the single source of truth, injected as `APP_VERSION` by the root `Makefile`. It shows up live at `/api/v1/docs` (this file's `version=` in the Swagger UI) on whichever environment you hit, and each environment's image is tagged with it (`chat_realtime_demo-backend:1.0.0-dev` / `...-staging` / bare `...1.0.0` for prod — `docker images` shows all three). Bump `VERSION` and rerun `make <env>` to release a new version.

MySQL data persists in a named volume per environment (`docker compose down -v` — or `make dev-down` etc. followed by a manual `docker volume rm` — to wipe it). This is independent from local (non-Docker) dev — `chat_with_fastapi`'s own `make dev`/`npm run dev` (note: same target name, different Makefile — that one is backend-only, non-Docker) and the existing `.env` files inside `chat_with_fastapi/`/`chat_frontend/` are unaffected; container-specific hostnames (`mysql`, `redis`) are injected via each `docker-compose.*.yml`'s `environment:` block.

## Testing

```bash
make test
# equivalent to: pytest (runs with coverage — see pytest.ini)
```

Unit tests for the service layer (`app/services/`) live in `tests/`, using mocked DB sessions (`unittest.mock.MagicMock(spec=AsyncSession)`) — no real database required.

## Migrations

```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
alembic downgrade -1
```

## Project structure

```
app/
├── main.py              # FastAPI app, CORS, mounts api_router at /api/v1
├── api/
│   ├── main.py          # aggregates route modules
│   ├── deps.py          # CurrentUser (JWT), Language (Accept-Language header)
│   └── routes/          # auth, user, conversation, message
├── core/
│   ├── config.py        # env-based settings
│   ├── database.py      # async engine/session factory
│   ├── security.py      # JWT + password hashing
│   └── websocket.py     # ConnectionManager (rooms + user channels, backed by Redis Pub/Sub)
├── models/              # SQLAlchemy ORM models (source of truth for schema)
├── schemas/             # Pydantic request/response models
├── services/            # business logic, instantiated per-request with a DB session
├── utils/               # translator.py (i18n), helpers.py
└── init_data.py         # create all tables from metadata (alt. to Alembic)
```

## Data model

- **User** — UUID PK; `role`: `admin`/`user`; `is_active`, `is_online`, `last_seen_at`
- **Conversation** — UUID PK; `type`: `direct` | `group`
- **ConversationMember** — links users to conversations; `role`: `owner`/`admin`/`member`; `left_at` (soft-remove), `last_read_message_id` (read receipts)
- **Message** — UUID PK; `type`: `text`/`image`/`video`/`file`/`mixed`/`system`; self-referential `reply_to_message_id`
- **MessageAttachment** — files attached to a message
- **MessageRead** — fine-grained per-user read log

## API overview

| Route | Description |
|---|---|
| `POST /auth/login` | OAuth2 password login → JWT |
| `POST /users/` | Public registration |
| `GET /users/search?q=` | Search users |
| `GET /users/me`, `PUT /users/me` | Current user profile |
| `DELETE /users/disable/{id}` | Disable a user |
| `GET /conversations` | List current user's conversations |
| `POST /conversations` | Create a group, or reuse an existing direct conversation |
| `POST /conversations/{id}/members` | Add members to a conversation |
| `GET /messages/{conversation_id}` | Paginated message history (`before_id`) |
| `POST /messages/send` | Send a message (broadcasts over WebSocket) |
| `WS /messages/ws/{conversation_id}?token=<jwt>` | Join a conversation room |
| `WS /messages/ws/user/me?token=<jwt>` | User-level channel for cross-conversation notifications |

Sending a message broadcasts `{"event": "new_message", "data": {...}}` to the conversation room and to each member's user-level channel, so the sidebar/unread state updates even outside the open conversation.

## Realtime architecture (Redis Pub/Sub)

`ConnectionManager` (`app/core/websocket.py`) keeps locally-connected sockets in per-process dicts (`_rooms`, `_users`), but `broadcast()`/`notify_user()` never write to those sockets directly — they `PUBLISH` a small JSON envelope (`{"scope": "room"|"user", "target": ..., "payload": ...}`) to a single Redis channel (`ws:events`). A background task started in `app/main.py`'s `lifespan` hook subscribes to that channel and delivers to whichever local sockets match, in every running process.

This means a message sent to any uvicorn worker/replica reaches sockets connected to any other worker/replica — the previous in-memory-only implementation only worked with a single process. Redis must be reachable for the app to start.

## Notes

- On Windows, `app/core/database.py` sets `WindowsSelectorEventLoopPolicy`, required for `aiomysql`.
