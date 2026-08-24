# Chat Realtime — HTTP API (FastAPI)

The REST half of the chat backend: FastAPI + SQLAlchemy (async) + MySQL + Alembic + JWT auth. Serves no WebSockets — those live in a separate, separately-deployed service, [`../chat_with_fastapi_ws`](../chat_with_fastapi_ws). This project owns the database schema and issues the tokens that one verifies.

## Stack

- **FastAPI** — HTTP API only
- **SQLAlchemy 2.0** (async, `aiomysql`) — ORM
- **MySQL** — database
- **Redis** — publishes realtime events for the WebSocket service to deliver (`app/core/events.py`)
- **Alembic** — schema migrations
- **python-jose** + **bcrypt** — JWT auth & password hashing

## Setup

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

You also need a **Redis server running locally** — it is how realtime events reach the WebSocket service:

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

The repo root (`chat_realtime_demo/`) has three environments — dev, staging, production — one compose file each, holding a full stack (MySQL, Redis, a one-shot `migrate` service, this API as 3 replicas behind nginx, the WebSocket service as its own separately-deployable side, and the frontend), each on its own port range so all three can run at once:

```bash
cd ..              # repo root, alongside chat_frontend/
make dev           # :8000 backend / :5173 frontend — bind-mounted source, --reload
make staging       # :8080 backend / :5174 frontend — real build, needs .env.staging first
make prod          # :9000 backend / :5175 frontend — real build, needs .env.prod first
```

`make dev` starts this service only — the WebSocket side shares the same compose file but has its own targets (`make ws`, `make ws-staging`, `make ws-prod`), and each target names only its own services, so releasing one side never touches the other's containers. `make up` runs the whole dev environment, which is what `e2e/` uses. Staging/prod need a one-time setup step: `cp .env.staging.example .env.staging` (and the same for prod), then fill in real values — the placeholder `.example` values are not safe to run with as-is. `make {dev,staging,prod}-down` removes just this service's containers in that environment; `make down` / `make {staging,prod}-down-all` tears a whole environment down.

Only dev builds with source bind-mounted and `uvicorn --reload`; staging/prod run whatever's baked into the image at build time (closer to a real release artifact), and the frontend runs an actual `vite build && vite preview` there instead of the dev server. `nginx` is the only container publishing its environment's backend port to the host in every case — the three API replicas are internal-only, reachable only through nginx's `upstream api_pool` (`nginx/nginx.conf`, shared across all three environments, round-robin + passive health checks). The WebSocket service has its own nginx and its own port (`nginx/nginx.ws.conf`, :8001/:8081/:9001), so either side can be restarted or fail without touching the other. Response header `X-Upstream-Addr` shows which replica handled a request. This is why the Redis Pub/Sub design in [Realtime architecture](#realtime-architecture-redis-pubsub) matters: the replica that handles a send is never the one holding the recipient's socket, and clients still see messages live.

**Versioning:** the root `VERSION` file (e.g. `1.0.0`) is the single source of truth, injected as `APP_VERSION` by the root `Makefile`. It shows up live at `/api/v1/docs` (this file's `version=` in the Swagger UI) on whichever environment you hit, and each environment's image is tagged with it (`chat_realtime_demo-backend:1.0.0-dev` / `...-staging` / bare `...1.0.0` for prod — `docker images` shows all three). Bump `VERSION` and rerun `make <env>` to release a new version.

MySQL data persists in a named volume per environment (`docker compose down -v` — or `make dev-down` etc. followed by a manual `docker volume rm` — to wipe it). This is independent from local (non-Docker) dev — `chat_with_fastapi`'s own `make dev`/`npm run dev` (note: same target name, different Makefile — that one is backend-only, non-Docker) and the existing `.env` files inside `chat_with_fastapi/`/`chat_frontend/` are unaffected; container-specific hostnames (`mysql`, `redis`) are injected via each `docker-compose.*.yml`'s `environment:` block.

## Testing

```bash
make test
# equivalent to: pytest (runs with coverage — see pytest.ini)
```

`tests/services/` covers the service layer with mocked DB sessions (`unittest.mock.MagicMock(spec=AsyncSession)`); `tests/core/` covers the Redis event envelope and the presence reader. No real database or Redis required.

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
│   ├── events.py        # publishes realtime events for the WebSocket service
│   ├── presence.py      # reads who is online (the WebSocket service writes it)
│   └── storage.py       # where uploaded files go — local disk today, S3 later
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
- **MessageRead** — a per-message read log, currently unused: read receipts use `ConversationMember.last_read_message_id` as a per-member watermark instead, which answers both "did they see it?" and "who saw it?" without growing with the message count

## API overview

| Route | Description |
|---|---|
| `POST /auth/login` | OAuth2 password login → JWT |
| `POST /users/` | Public registration |
| `GET /users/search?q=` | Search users |
| `GET /users/me`, `PUT /users/me` | Current user profile — `PUT` is partial (`full_name`, `email`, `password`); `username` is fixed |
| `POST /users/me/avatar` | Upload an avatar (multipart) — validated by magic bytes, max 5MB |
| `DELETE /users/me/avatar` | Remove your avatar |
| `DELETE /users/disable/{id}` | Disable a user |
| `GET /conversations` | List current user's conversations |
| `POST /conversations` | Create a group, or reuse an existing direct conversation |
| `POST /conversations/{id}/members` | Add members to a conversation |
| `GET /messages/{conversation_id}` | Paginated message history (`before_id`) |
| `POST /messages/send` | Send a message (publishes it for the WebSocket service to deliver) |
| `GET /messages/{conversation_id}/reads` | Every member's read watermark |
| `POST /messages/{conversation_id}/read` | Advance your own read watermark |

Avatars are a separate multipart endpoint rather than an `avatar_url` field on `PUT /users/me`, so the stored URL always comes from bytes the server validated — never a client-supplied string. Uploads are checked three ways (declared content-type, a 5MB cap enforced while streaming, and magic-byte sniffing that rejects a script named `.png`), then written through `app/core/storage.py` and served back at `/uploads/...`. That module is the seam for the eventual move to S3: same `save`/`delete`, different backend, no route or schema changes. Behind the load balancer the upload directory is a volume shared by every API replica, since nginx round-robins and the replica serving a file is rarely the one that wrote it.

The two `WS /messages/ws/...` endpoints are served by [`../chat_with_fastapi_ws`](../chat_with_fastapi_ws) on port 8001, under the same URL prefix.

Sending a message broadcasts `{"event": "new_message", "data": {...}}` to the conversation room and to each member's user-level channel, so the sidebar/unread state updates even outside the open conversation.

## Realtime architecture (Redis Pub/Sub)

This project holds no sockets. `EventPublisher` (`app/core/events.py`) `PUBLISH`es a JSON envelope to a single Redis channel (`ws:events`):

```json
{"scope": "room", "target": "<conversation_id>", "payload": {...}, "exclude": "<user_id>|null"}
```

The WebSocket service subscribes to that channel and delivers to whichever of its sockets match, in every one of its replicas. So the replica that handled the request need not be — and now never is — the one holding the recipient's socket, and no session affinity is needed anywhere.

Publishing needs no subscription, so nothing here starts a listener. Delivery is best-effort: the message is already committed when the publish happens, so a Redis blip logs a warning rather than failing the request.

**Shared with the WebSocket service, and easy to break:** the envelope shape above (pinned by `tests/core/test_events.py`), `SECRET_KEY`/`ALGORITHM` (a mismatch rejects every socket with close code 4001), and the presence key layout in `app/core/presence.py` — which this project only reads; the WebSocket service writes it.

## Notes

- On Windows, `app/core/database.py` sets `WindowsSelectorEventLoopPolicy`, required for `aiomysql`.
