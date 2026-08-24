# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

```
chat_realtime_demo/
├── chat_with_fastapi/         # HTTP API service (FastAPI) — REST only, no sockets
├── chat_with_fastapi_ws/      # WebSocket service (FastAPI) — sockets only, no REST
├── chat_frontend/             # React frontend (Vite + TypeScript)
├── e2e/                       # Playwright end-to-end tests (drives the two above)
├── nginx/nginx.conf           # HTTP API load balancer (all three environments)
├── nginx/nginx.ws.conf        # WebSocket load balancer — separate deployment, separate port
├── VERSION                    # single source of truth for the app version — see Environments
├── Makefile                   # root-level: `make dev`/`staging`/`prod` — do not confuse with
│                               # chat_with_fastapi/Makefile's `make dev` (that one is backend-local,
│                               # non-Docker `uvicorn --reload`; this one is the whole Docker stack)
├── docker-compose.yml         # dev: HTTP API + infra (MySQL/Redis/migrate) + frontend
├── docker-compose.ws.yml      # dev: WebSocket service — deployed separately, port 8001
├── docker-compose.staging.yml / docker-compose.ws.staging.yml  # same pair, staging
├── docker-compose.prod.yml    / docker-compose.ws.prod.yml     # same pair, production
├── .env                       # dev secrets (committed — placeholder values only)
└── .env.staging / .env.prod   # staging/prod secrets (gitignored — copy from the .example files)
```

### Environments (dev / staging / production)

Three independent, identically-shaped environments (MySQL, Redis, a one-shot `migrate` service, 3 HTTP API replicas behind nginx, 2 WebSocket replicas behind their own nginx, frontend), each on its own port range so **all three can run at once on one machine**.

Each environment ships as **two deployments** — the HTTP API and the WebSocket service, on separate ports (see the next section for why):

| Env | HTTP API | WebSockets | Frontend | MySQL/Redis published? |
|---|---|---|---|---|
| dev | `make dev` → `:8000` | `make ws` → `:8001` | `:5173`, `vite dev` hot reload | yes (`:3306`/`:6379`) |
| staging | `make staging` → `:8080` | `make ws-staging` → `:8081` | `:5174`, real `vite build`+`preview` | no, internal only |
| prod | `make prod` → `:9000` | `make ws-prod` → `:9001` | `:5175`, real `vite build`+`preview` | no, internal only |

`make up` / `make down` bring up or tear down both dev deployments at once — convenience for local work only; real deploys go one side at a time. `e2e/playwright.config.ts` uses `make up` for the same reason.

`docker-compose.yml` **is** the dev environment — bind-mounted source, `--reload`, hardcoded dev placeholder secrets, unchanged from before. `docker-compose.staging.yml`/`docker-compose.prod.yml` are separate, self-contained compose files (same shape, no bind mounts — they run whatever's baked into the image, closer to a real release build) driven by `.env.staging`/`.env.prod`. First-time setup for either: `cp .env.staging.example .env.staging` (and same for prod), fill in real values — the committed dev `.env` is fine as-is (its secrets are already public in `docker-compose.yml`'s history), but the `.example` placeholders for staging/prod are **not** safe to run with as-is. `make {staging,prod}-down` (and `make ws-{staging,prod}-down`) tear each down without touching the others (`-p chat_realtime_demo_{staging,prod}` gives each its own container/network namespace, which is also what lets all three coexist).

**Versioning:** `VERSION` at the repo root (e.g. `1.0.0`) is the single source of truth. The root `Makefile` reads it and exports it as `APP_VERSION` before invoking `docker compose`, which flows into two places per environment: the backend's `APP_VERSION` setting (visible live at `/api/v1/docs` on any environment — FastAPI's `version=` field) and each image's tag (`chat_realtime_demo-backend:1.0.0-dev`, `...-staging`, or bare `...1.0.0` for prod — `docker images` shows all three side by side). To release a new version: bump `VERSION`, rerun `make <env>` — nothing else to touch.

#### Two services: HTTP API and WebSockets

The backend is **two separate FastAPI projects**, deployed independently:

| | `chat_with_fastapi/` | `chat_with_fastapi_ws/` |
|---|---|---|
| Serves | REST only — no `WebSocket` import anywhere | The two socket endpoints only — no REST routes |
| Redis | publishes (`app/core/events.py`) | publishes *and* subscribes (`app/core/websocket.py`) |
| Database | full ORM + Alembic, owns the schema | four explicit SQL statements (`app/db/queries.py`), read-mostly |
| Dev port | `:8000` | `:8001` |
| Compose | `docker-compose.yml` (`make dev`) | `docker-compose.ws.yml` (`make ws`) |
| nginx | `nginx/nginx.conf` | `nginx/nginx.ws.conf` |

Why split at all: the two kinds of traffic scale on different limits — HTTP requests are short and CPU/DB-bound, sockets are long-lived and memory/file-descriptor-bound — and a problem in one should not take the other down. Verified by stopping each side in turn: with the API down, open sockets stay open, new ones are still accepted and typing still flows; with the WS service down, `POST /messages/send` still returns 201 and persists.

**The four things the two must agree on.** They never call each other, so these are the entire contract, and getting one wrong fails at runtime rather than at build time:

1. **The Redis envelope** — `{"scope": "room"|"user", "target": ..., "payload": ..., "exclude": ...}` on channel `ws:events`. Written by `events.py` here, read by `websocket.py` there. `tests/core/test_events.py` pins the wire format.
2. **`SECRET_KEY` and `ALGORITHM`** — the WS service only *verifies* tokens the API issues. A mismatch rejects every socket with close code 4001, which surfaces to the browser as a bare handshake failure, so check this first when sockets 403 and nothing else looks wrong.
3. **The presence layout** — one Redis sorted set per user, `presence:{user_id}`, plus a matching `CONNECTION_TTL_SECONDS` on both sides. The WS service writes and refreshes; the API only reads (`PresenceReader.online_among`).
4. **The database schema** — the WS service reads `users` and `conversation_members` and writes `users.is_online` / `users.last_seen_at`. It deliberately uses explicit SQL instead of copying six ORM model files, so the coupling is four statements in one file rather than a second copy of the models drifting quietly. Migrations belong to the API project alone; there is no second Alembic to race.

They also share MySQL and Redis themselves, unavoidably — Redis going down stops realtime no matter how the code is split.

#### Load balancing (`nginx/nginx.conf`)

`nginx.conf` (API) and `nginx.ws.conf` (WebSockets) are bind-mounted read-only into their respective deployments across all three environments. `nginx` is the only container publishing its environment's backend port to the host; `backend-a/b/c` and `ws-a/b` are internal-only and only reachable through it. Each config has one upstream (`api_pool` in one, `ws_pool` in the other — see the split above) listing its replicas by fixed compose service name (not a scaled service — nginx's `upstream` block resolves hostnames once at config-load time, so a bare service name behind `docker compose --scale` wouldn't actually round-robin), with passive health checks (`max_fails`/`fail_timeout`). The response header `X-Upstream-Addr` shows which replica served a given request — useful for confirming the balancing is real (`curl -sI http://localhost:8000/api/v1/docs`, or `:8080`/`:9000` for staging/prod).

This is where the Redis Pub/Sub design described below pays off, and it's what makes the api/ws split possible at all: a `POST /messages/send` handled by `backend-b` in the API service publishes to Redis, and `ws-a`/`ws-b` in the WebSocket service each have their own listener task that delivers to *their* locally-connected sockets. So the replica that handled the request need not be — and now never is — the one holding the recipient's socket, and two users whose sockets land on different ws replicas (nginx guarantees no session affinity, and none is needed) still see messages in real time. Migrations run once via the separate `migrate` service specifically to avoid every replica racing to apply `alembic upgrade head` concurrently on startup.

---

## HTTP API service (`chat_with_fastapi/`)

All commands run from inside `chat_with_fastapi/`.

```bash
# Activate virtualenv (Windows)
venv\Scripts\activate

# Run the dev server
make dev                 # equivalent to: uvicorn app.main:app --reload

# Run tests (mocked DB sessions, no real database required)
make test                # equivalent to: pytest (runs with coverage — see pytest.ini)

# Database migrations
alembic revision --autogenerate -m "description"
alembic upgrade head
alembic downgrade -1
```

API docs: `/api/v1/docs` (Swagger), `/api/v1/redoc`.

### Backend environment

Copy `.env.example` to `.env`:

```
DATABASE_URL=mysql+aiomysql://root:PASSWORD@localhost:3306/DB_NAME
DATABASE_SYNC_URL=mysql+pymysql://root:PASSWORD@localhost:3306/DB_NAME
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=your-secret-key
```

`DATABASE_SYNC_URL` is used by Alembic; `DATABASE_URL` (async) is used at runtime. `REDIS_URL` defaults to `redis://localhost:6379/0` if unset, but **a reachable Redis server is required at app startup** — `ConnectionManager` publishes/subscribes through it and the app won't come up without it (`brew install redis && brew services start redis` locally, or use `docker compose up`).

### Backend architecture

**Stack:** FastAPI + SQLAlchemy (async, `aiomysql`) + MySQL + Redis (Pub/Sub) + Alembic + JWT (python-jose) + bcrypt

**Request flow:**
1. `app/main.py` — FastAPI app, CORS middleware, mounts `api_router` at `/api/v1`; `lifespan` hook starts/stops `ConnectionManager`'s Redis pub/sub listener task
2. `app/api/main.py` — aggregates route modules: auth, user, conversation, message
3. `app/api/deps.py` — `CurrentUser` (JWT → User), `Language` (from `Accept-Language` header)
4. Routes call service classes; services hold an `AsyncSession`

**Layer conventions:**
- `app/models/` — SQLAlchemy ORM models (source of truth for schema)
- `app/schemas/` — Pydantic request/response models
- `app/services/` — business logic instantiated per-request with a DB session
- `app/api/routes/` — thin routers that wire HTTP → services
- `app/core/` — config, DB session factory, JWT security, `events.py` (publishes to the WebSocket service) and `presence.py` (reads who is online); both Redis-backed. `storage.py` holds the file-storage backend (below)
- `app/utils/translator.py` — i18n via `app/locales/{en,vi}.json`; `app/utils/images.py` validates uploaded images

**Data model summary:**
- `User` — UUID PK; `role`: `admin`/`user`; `is_active`, `is_online`, `last_seen_at`
- `Conversation` — UUID PK; `type`: `direct` | `group`
- `ConversationMember` — int PK; links users to conversations; `role`: `owner`/`admin`/`member`; `left_at` (soft-remove), `last_read_message_id` for read receipts
- `Message` — UUID PK; `type`: `text`/`image`/`video`/`file`/`mixed`/`system`; self-referential `reply_to_message_id`; composite index `(conversation_id, created_at)`
- `MessageAttachment` — int PK; files attached to a message
- `MessageRead` — int PK; fine-grained per-user read log

**Routes overview:**
- `auth.py` — `POST /auth/login` (OAuth2 password form → JWT)
- `user.py` — `POST /users/` (public registration), `GET /users/search?q=`, `GET|PUT /users/me`, `POST|DELETE /users/me/avatar` (profile editing, below), `DELETE /users/disable/{id}`
- `conversation.py` — `GET /conversations`, `POST /conversations` (creates group, or reuses an existing direct conversation between the two users), `POST /conversations/{id}/members`
- `message.py` — `GET /messages/{conversation_id}` (paginated history via `before_id`), `POST /messages/send`, `GET /messages/{conversation_id}/reads` + `POST /messages/{conversation_id}/read` (read receipts, below). The WebSocket endpoints referenced below are served by the *other* project, on port 8001, under the same `/messages` URL prefix

**Profile editing & avatar uploads:** `PUT /users/me` is a *partial* update — the service applies `model_dump(exclude_unset=True)`, so an absent key means "leave it alone" while an explicit `full_name: null` clears it (the frontend relies on this to distinguish the two). Editable: `full_name`, `email`, `password`. Changing `email` re-checks uniqueness but treats a row that turns out to be *you* as a non-conflict, so a no-op save doesn't fail. Changing the password requires `current_password` and verifies it: a valid JWT alone isn't proof of ownership, and a password change locks the real owner out. Conflicts raise `ProfileUpdateError` carrying a translator key, which the route renders in the caller's `Accept-Language` — the same shape registration conflicts already used.

**`username` is not editable — anywhere.** It's the login identifier (`POST /auth/login` takes it, not the email), so changing it would invalidate what the user and their password manager type at the sign-in form, plus every `@name` anyone has seen. It's absent from `UserUpdate`, which means Pydantic drops it from the payload: a client that sends `{"username": "...", "full_name": "..."}` gets the name applied and the username ignored, never a partial-looking success. The UI shows it read-only rather than hiding it, so people can still see which account they're signed in as.

Avatars are a separate multipart endpoint (`POST /users/me/avatar`) rather than an `avatar_url` field on `UserUpdate`, deliberately: the stored URL must come from bytes the server validated, never from a client-supplied string (which could be a `javascript:` URL rendered into an `<img src>`). `app/utils/images.py` layers three checks — the declared `content_type`, a size cap enforced *while streaming* (so a huge upload is abandoned rather than buffered then rejected), and **magic-byte sniffing**, which is the one that matters: a PHP script or HTML page named `.png` fails here, and the extension the file is stored under comes from the sniffed type, not the filename. Only JPEG/PNG/GIF/WebP pass, which is also why serving the upload directory as static files can't turn into stored XSS — no SVG or HTML ever lands there. It's dependency-free on purpose (Pillow would add a native image decoder for the same answer; add it the day thumbnails are wanted).

**File storage (`app/core/storage.py`) — local disk now, S3 later.** Everything that writes user files goes through the `storage` singleton: callers hand over bytes and get back a public URL to store in the database, and nothing else knows where the bytes live. Migrating means writing an `S3Storage` with the same `save`/`delete` and repointing `storage` — no service, route or migration changes. Rows written by the local backend keep working, because `delete()` ignores URLs it doesn't own (an absolute `https://...` isn't its file to unlink — the same guard that stops a crafted `../..` from escaping the root). `set_avatar()` commits *before* deleting the previous file, so a rolled-back transaction can't leave a row pointing at a file that's gone, and deletes the file it just wrote if the commit fails.

Two deployment details make this work behind the load balancer: `UPLOAD_DIR` is a **named volume shared by `backend-a/b/c`** in every compose file (nginx round-robins, so the replica serving `GET /uploads/...` is almost never the one that wrote it), and `nginx/nginx.conf` sets `client_max_body_size 8m` — above the app's own 5MB `MAX_AVATAR_BYTES`, so a legitimate photo reaches FastAPI's validation and gets a JSON error instead of nginx's opaque 413, while something absurd is still stopped at the edge. `main.py` mounts `UPLOAD_DIR` as StaticFiles at `/uploads`, *outside* `API_PREFIX` — these are files, not API resources, and the URL is what's stored in the database.

**Messaging & WebSocket flow:**
- `POST /api/v1/messages/send` — saves `Message` + attachments, bumps `Conversation.updated_at`, then broadcasts `{"event": "new_message", "data": {...}}` twice: to conversation-room sockets via `manager.broadcast()` and to every member's user-level channel via `manager.notify_users()` (so members not currently viewing that conversation still get notified)
- `WS /api/v1/messages/ws/{conversation_id}?token=<jwt>` — validates token + conversation membership on connect; joins the conversation room
- **Read receipts ("seen")** use `ConversationMember.last_read_message_id` as a per-member *watermark* — "read up to here" — rather than a row per (message, user). That answers both "did they see it?" and, in a group, "who saw it?" in one row per member instead of growing with the message count, which is why the `MessageRead` table stays unused. `POST /messages/{id}/read` `{message_id}` advances it (never backwards — clients scrolled up through history would otherwise un-read messages), and broadcasts `{"event": "message_read", "data": {conversation_id, user_id, username, full_name, avatar_url, last_read_message_id}}` to the room only — unlike `send_message`, there is no user-channel fan-out, because a receipt only matters to someone currently looking at that conversation and anyone opening it later refetches `GET /reads` (fanning out would cost one Redis publish per member for something nobody would see). `MessageService.send()` also advances the sender's own watermark in the same transaction. Only a watermark that actually moved is broadcast. The frontend groups receipts by `last_read_message_id`, so each reader's avatar renders under the last message they read
- **Typing indicators** ride *up* the same room socket — the only frames a client sends. `{"event": "typing", "data": {"is_typing": true|false}}` is broadcast back out to the room as `{"event": "typing", "data": {conversation_id, user_id, username, full_name, avatar_url, is_typing}}` (the identity fields come straight off the `User` already loaded for the socket's auth check, so the client can render an avatar without a second lookup), with `broadcast(..., exclude_user_id=...)` skipping the sender's own sockets. Anything else sent up the socket (including non-JSON keepalives) is ignored rather than closing the connection. A disconnect auto-broadcasts `is_typing: false`, since a client that closes mid-typing never gets to retract it; the frontend additionally expires a stale flag after `TYPING_TTL_MS` (`chatStore.ts`) in case even that is lost
- `WS /api/v1/messages/ws/user/me?token=<jwt>` — user-level channel that receives `new_message` events for every conversation the user belongs to (used to update the sidebar/unread state outside the currently open conversation)

**Online presence (`app/core/presence.py`):** the user-level WebSocket is the signal — it lives for the whole session, one per tab, so connect means online and disconnect means offline. `PresenceTracker` keeps one Redis sorted set per user (`presence:{user_id}`) whose members are connection ids and scores are the last heartbeat, because presence has to be *counted*, not flagged: a user with two tabs open (possibly on two different replicas) must stay online when one closes. `connected()`/`disconnected()` return whether the user actually crossed the online/offline boundary, so only real transitions broadcast. Reads apply a `CONNECTION_TTL_SECONDS` cutoff by score, which means entries left by a replica that died without running its disconnect path stop counting on their own — no sweeper task, no ghost "online" users. A per-connection heartbeat task refreshes the score every `HEARTBEAT_INTERVAL_SECONDS`. Redis failures degrade to "nobody online" rather than breaking the socket.

Redis is the **live truth**; `User.is_online` is only the last known value (written on transitions alongside `last_seen_at`), so `GET /conversations` and `GET /users/search` overlay `presence.online_among(...)` onto their responses instead of trusting the column. A transition notifies only `ConversationService.get_contact_ids()` — people who share a conversation with you — since broadcasting to every account would both leak who is online to strangers and cost a publish per user on the instance. Event shape: `{"event": "presence", "data": {user_id, is_online, last_seen_at}}` on the user channel; the frontend's `receivePresence` patches `is_online` on the member profiles inside each conversation, which is where the sidebar and chat header already read it from.

**Realtime architecture (Redis Pub/Sub):** in `chat_with_fastapi_ws`, `app/core/websocket.py`'s singleton `ConnectionManager` keeps locally-connected sockets in per-process dicts (`_rooms`: `conversation_id → [(user_id, WebSocket)]`, `_users`: `user_id → [WebSocket]`), but `broadcast()`/`notify_user()` never write to those sockets directly — they `PUBLISH` a JSON envelope (`{"scope": "room"|"user", "target": ..., "payload": ...}`) to a single Redis channel (`ws:events`). A background task (started in `main.py`'s `lifespan`) subscribes to that channel and delivers to whichever local sockets match, in *every* running process. That listener is the *only* thing delivering realtime events in its process and nothing restarts it, so its loop deliberately swallows and logs per-event exceptions — an escaping error would silently kill every WebSocket update until the process restarts. Relatedly, the delivery helpers prune dead sockets by rebuilding the list rather than `list.remove()`: a socket's own `disconnect()` can prune it first while a send is awaiting, and `remove()` would then raise on the missing entry. This is what lets a message sent to any uvicorn worker/replica reach sockets connected to any other worker/replica — the connection manager is no longer single-process-only, which is what makes horizontally scaling the backend behind a load balancer possible.

**Auth:** `POST /api/v1/auth/login` accepts `OAuth2PasswordRequestForm`, returns JWT. `get_current_user` dep decodes token and loads `User` each request.

**Bootstrapping the DB schema:** `python -m app.init_data` calls `init_db()` to create all tables directly from the SQLAlchemy metadata — an alternative to `alembic upgrade head` for a fresh throwaway DB (Alembic migrations remain the source of truth otherwise).

**Windows async fix:** `app/core/database.py` sets `WindowsSelectorEventLoopPolicy` on `win32` — required for `aiomysql`.

**Error tracking (Sentry):** gated entirely on `SENTRY_DSN` (`app/core/config.py`) being set — unset (the default) means `sentry_sdk.init()` in `main.py` never runs, so dev stays silent unless you opt in. `release` is set to `settings.APP_VERSION` (the same VERSION-file-driven value used everywhere else), `environment` to `SENTRY_ENVIRONMENT` (`development`/`staging`/`production`, defaulted per compose file). FastAPI/Starlette/SQLAlchemy/Redis integrations are auto-detected — no explicit `integrations=[...]` list needed. Frontend mirrors this: `VITE_SENTRY_DSN` gates `Sentry.init()` in `main.tsx`, same `release`/`environment` convention, plus a `Sentry.ErrorBoundary` wrapping `<App />` for uncaught render errors.

**Tests:** `chat_with_fastapi/tests/services/` — unit tests for the service layer, using `unittest.mock.MagicMock(spec=AsyncSession)` (see `tests/conftest.py`'s `mock_db`/`make_result` fixtures). `chat_with_fastapi/tests/api/test_typing_events.py` covers what sits outside that layer: the WebSocket frame parser and the connection manager's room delivery (sender exclusion, dead-socket pruning). `tests/utils/test_images.py` and `tests/core/test_storage.py` cover upload validation (including a script wearing an `image/png` content type) and the storage guards. No real database required; run via `make test` / `pytest` (coverage configured in `pytest.ini`).

---

## WebSocket service (`chat_with_fastapi_ws/`)

All commands run from inside `chat_with_fastapi_ws/`.

```bash
make dev     # uvicorn app.main:app --reload --port 8001
make test    # pytest (mocked Redis and DB session — no infrastructure needed)
```

`cp .env.example .env` first. Only `DATABASE_URL`, `REDIS_URL` and `SECRET_KEY` matter, and the last two **must match the HTTP API's** — see the contract in Environments above.

**Stack:** FastAPI + SQLAlchemy (async, `aiomysql`, no ORM models) + Redis (Pub/Sub) + JWT verification (python-jose). No Alembic, no bcrypt/passlib, no Pydantic request schemas — it issues no tokens, hashes no passwords and owns no schema.

**Layout:**
- `app/main.py` — app + `lifespan` that starts the pub/sub listener; `GET /health` is liveness-only and deliberately does not touch MySQL or Redis, since sockets survive a database blip and failing the check would make an orchestrator restart the process and drop every connection
- `app/api/routes/ws.py` — the two endpoints, plus typing broadcast and presence publishing
- `app/core/websocket.py` — `ConnectionManager`: local socket registries + Redis pub/sub listener
- `app/core/presence.py` — `PresenceTracker`: connection counting, heartbeats, transitions
- `app/db/queries.py` — every SQL statement this service issues, four of them

**Tests:** `tests/` — the client-frame parser, room delivery and dead-socket pruning, presence counting, and the query mapping. Mocked throughout; the live-schema proof is `e2e/tests/{typing,presence,realtime}.spec.ts`.

---

## Frontend (`chat_frontend/`)

All commands run from inside `chat_frontend/`.

```bash
npm install         # install dependencies
npm run dev          # dev server on http://localhost:5173
npm run build        # production build to dist/ (runs tsc -b first)
npm run preview      # preview production build
npm run lint          # eslint
npm run test          # vitest run (component/store unit tests)
npm run test:watch    # vitest, watch mode
```

### Frontend environment

Two backends, two ports (`src/api/client.ts` falls back to these when unset):
```
VITE_API_URL=http://localhost:8000/api/v1   # chat_with_fastapi
VITE_WS_URL=ws://localhost:8001/api/v1     # chat_with_fastapi_ws
```

### Frontend architecture

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + Zustand + Axios + React Router v7 + Vitest + Testing Library

**Design tokens** (defined in `src/index.css` via `@theme`):
- Primary: `#AEE2FF` — used for message bubbles (sent), active states, avatar backgrounds, buttons
- Secondary: `#FCF8F8` — used for page/sidebar backgrounds

Use `bg-primary`, `bg-secondary`, `text-primary` etc. (Tailwind utility classes wired to these tokens).

**Dark/light theme:** separate from the tokens above — `src/index.css` defines a second layer of CSS custom properties (`--bg-base`, `--bg-surface`, `--text-primary`, etc.) under `:root` (light) and `.dark` (dark), with `@custom-variant dark (&:where(.dark, .dark *))`. `src/stores/themeStore.ts` (Zustand, persisted) holds `theme: 'dark' | 'light'` and toggles the `.dark` class on `<html>`; `App.tsx` applies it on mount via `applyTheme()`. `src/components/ui/ThemeToggle.tsx` is the UI control.

**State management (Zustand):**
- `src/stores/authStore.ts` — `token`, `user`; `login()`, `logout()`, `fetchMe()`, plus `updateProfile()`/`uploadAvatar()`/`removeAvatar()` (each takes the updated user straight from the response instead of re-fetching `/users/me`); persisted to `localStorage` via `zustand/middleware persist`
- `src/stores/chatStore.ts` — `conversations`, `activeConversationId`, `messages` (keyed by `conversation_id`), `typing` (`conversation_id → TypingUser[]`, excluding yourself), `ws`; `connectWs()` opens a WebSocket and wires `new_message` events to `receiveMessage()` and `typing` events to `receiveTyping()`; `sendMessage()` calls the REST API and deduplicates against incoming WS events; `sendTyping()` pushes your own typing state up the room socket (throttled by `MessageInput`, which re-announces at most every 2.5s and retracts after 2.5s idle); `reads` (`conversation_id → ReadReceipt[]`) plus `fetchReads`/`receiveRead`/`markRead` hold read watermarks, with `markedRead` collapsing the repeat `markRead` calls that fire as messages arrive while a conversation stays open
- `src/stores/themeStore.ts` — see above
- `src/stores/toastStore.ts` — transient notifications (`showToast(message, variant)`), rendered by `src/components/ui/Toaster.tsx`, which `App` mounts *outside* `<Routes>`. That placement is the point: saving your profile closes the modal, so an inline confirmation would unmount before anyone read it. Each toast self-dismisses after `TOAST_TTL_MS`; ids come from a counter rather than `Date.now()`, which collides when two are raised in the same millisecond

**File layout:**
- `src/api/` — thin Axios wrappers (`client.ts` adds the Bearer token interceptor, `auth.ts`, `users.ts`, `messages.ts`, `conversations.ts`). `client.ts` also exports `resolveMediaUrl()`, which turns a stored `/uploads/...` path into a URL on the *API* origin — the frontend runs on a different port, where that path would hit the Vite dev server — and returns absolute URLs untouched, which is exactly what the move to S3 will start storing
- `src/types/index.ts` — all shared TypeScript interfaces (`User`, `Message`, `Conversation`, `Attachment`, etc.)
- `src/hooks/useDebounce.ts` — used to debounce the user-search input
- `src/utils/imageFile.ts` — client-side avatar checks (type + size), deliberately mirroring the server's rules rather than replacing them: they're a fast "no" before spending an upload, and the server still sniffs the actual bytes
- `src/components/ui/` — reusable primitives (`Avatar`, `ThemeToggle`). `Avatar` is the single place stored avatar URLs get resolved (`resolveMediaUrl`), which covers conversations, read receipts and typing indicators at once; it tracks *which* URL failed to load rather than a boolean, so a new upload gets a fresh attempt instead of being stuck behind one earlier broken image
- `src/components/profile/EditProfileModal.tsx` — profile editing, opened from your own row in the sidebar header. Sends only the fields that actually changed (a no-op save would otherwise trip the server's uniqueness check on your own email), uploads the avatar *before* the text fields so a rejected image doesn't leave a half-saved form, and previews the picked file via an object URL that's revoked on change. A successful save closes the modal and confirms via a toast; a failure keeps it open with an inline `Alert`, since the fields still need fixing. Removing a photo is the exception — it toasts but stays open, being one step of an edit that isn't finished yet
- `src/components/chat/` — feature components (`ConversationList`, `ChatWindow`, `MessageBubble`, `MessageInput`, `TypingIndicator` + its `typingLabel` helper, `ReadReceipts`, `AddMembersModal`, `CreateGroupModal`, `UserSearchDropdown`). `TypingIndicator` renders *outside* `ChatWindow`'s scroll container, pinned between it and `MessageInput`, so it stays at the bottom of the chat frame regardless of message count or scroll position
- `src/pages/` — route-level pages (`LoginPage`, `RegisterPage`, `ChatPage`)
- `src/App.tsx` — `BrowserRouter` + `RequireAuth`/`RedirectIfAuth` guards; routes: `/login`, `/register`, `/`

**Tests:** co-located `*.test.tsx`/`*.test.ts` files next to the code they cover (e.g. `ConversationList.test.tsx`, `MessageBubble.test.tsx`, `MessageInput.test.tsx`, `Avatar.test.tsx`, `EditProfileModal.test.tsx`, `imageFile.test.ts`, `toastStore.test.ts`, `useDebounce.test.ts`, `authStore.test.ts`, `chatStore.test.ts`), run with Vitest + Testing Library + jsdom.

---

## End-to-end tests (`e2e/`)

Playwright specs that drive the real frontend + backend together (not mocked). Run from inside `e2e/`:

```bash
npm install
npm run test        # playwright test
npm run test:ui     # playwright test --ui
```

`playwright.config.ts` starts the stack itself via two `webServer` entries — `make up` waiting on `http://localhost:5173`, and `make ws` waiting on `http://localhost:8001/health`. The second one matters: `reuseExistingServer` only checks its own URL, so without it a locally running vite would satisfy the config while nothing served sockets, and every realtime spec would fail on a connection error instead of saying what was missing. **`workers: 1`** is intentional — the target is a single dev-mode `uvicorn --reload` process, not a scaled multi-worker backend, and running specs concurrently was flaking it under load.

- `helpers/users.ts` — API-level fixtures (`registerUser`, `loginUser`, `createDirectConversation`) that set up test data directly via the backend REST API, skipping the UI where it isn't the thing under test
- `helpers/ui.ts` — UI-driven helpers (`loginViaUI`)
- `tests/auth.spec.ts` — register, log out, log back in, reject wrong credentials
- `tests/messaging.spec.ts` — start a direct conversation, send a message, survives reload
- `tests/groups.spec.ts` — create a group, send a message, add another member
- `tests/realtime.spec.ts` — a message sent by one user appears live for another with no reload (exercises the WebSocket/Redis pub-sub path end-to-end)
- `tests/presence.spec.ts` — a contact's sidebar row flips to Online on login and back to Offline when their tab closes, with no reload; and a second tab keeps them online when the first one closes (the case a boolean flag would get wrong)
- `tests/read-receipts.spec.ts` — a direct message flips to "Seen" live when the recipient opens the conversation, and a group message shows the avatar of the member who read it while a member who didn't stays absent
- `tests/profile.spec.ts` — rename yourself and see it in the sidebar after a reload (the dialog closes itself and a toast confirms); upload an avatar and fetch it back from the API (written by one replica, served by another through nginx); a non-image is rejected in the browser, a script renamed `.png` is rejected by the server's byte sniffing; a password change fails with the wrong current password and succeeds with the right one; the username renders read-only with no field to edit it
- `tests/typing.spec.ts` — one user's typing shows up live for the other (and is never echoed to the sender), clearing both when the input is emptied and when the message is sent
