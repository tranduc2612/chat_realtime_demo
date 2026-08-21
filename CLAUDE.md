# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

```
chat_realtime_demo/
├── chat_with_fastapi/         # Python backend (FastAPI)
├── chat_frontend/             # React frontend (Vite + TypeScript)
├── e2e/                       # Playwright end-to-end tests (drives the two above)
├── nginx/nginx.conf           # Load balancer config, shared by all three environments below
├── VERSION                    # single source of truth for the app version — see Environments
├── Makefile                   # root-level: `make dev`/`staging`/`prod` — do not confuse with
│                               # chat_with_fastapi/Makefile's `make dev` (that one is backend-local,
│                               # non-Docker `uvicorn --reload`; this one is the whole Docker stack)
├── docker-compose.yml         # dev environment
├── docker-compose.staging.yml # staging environment
├── docker-compose.prod.yml    # production environment
├── .env                       # dev secrets (committed — placeholder values only)
└── .env.staging / .env.prod   # staging/prod secrets (gitignored — copy from the .example files)
```

### Environments (dev / staging / production)

Three independent, identically-shaped stacks (MySQL, Redis, a one-shot `migrate` service, 3 backend replicas behind nginx, frontend), each runnable with a single `make` target and each on its own port range so **all three can run at once on one machine**:

| Env | Command | Backend (via nginx) | Frontend | MySQL/Redis published? |
|---|---|---|---|---|
| dev | `make dev` (or bare `docker compose up`, e.g. from `e2e/`) | `:8000` | `:5173`, `vite dev` hot reload | yes (`:3306`/`:6379`) |
| staging | `make staging` | `:8080` | `:5174`, real `vite build`+`preview` | no, internal only |
| prod | `make prod` | `:9000` | `:5175`, real `vite build`+`preview` | no, internal only |

`docker-compose.yml` **is** the dev environment — bind-mounted source, `--reload`, hardcoded dev placeholder secrets, unchanged from before. `docker-compose.staging.yml`/`docker-compose.prod.yml` are separate, self-contained compose files (same shape, no bind mounts — they run whatever's baked into the image, closer to a real release build) driven by `.env.staging`/`.env.prod`. First-time setup for either: `cp .env.staging.example .env.staging` (and same for prod), fill in real values — the committed dev `.env` is fine as-is (its secrets are already public in `docker-compose.yml`'s history), but the `.example` placeholders for staging/prod are **not** safe to run with as-is. `make {staging,prod}-down` tears each down without touching the others (`-p chat_realtime_demo_{staging,prod}` gives each its own container/network namespace, which is also what lets all three coexist).

**Versioning:** `VERSION` at the repo root (e.g. `1.0.0`) is the single source of truth. The root `Makefile` reads it and exports it as `APP_VERSION` before invoking `docker compose`, which flows into two places per environment: the backend's `APP_VERSION` setting (visible live at `/api/v1/docs` on any environment — FastAPI's `version=` field) and each image's tag (`chat_realtime_demo-backend:1.0.0-dev`, `...-staging`, or bare `...1.0.0` for prod — `docker images` shows all three side by side). To release a new version: bump `VERSION`, rerun `make <env>` — nothing else to touch.

#### Load balancing (`nginx/nginx.conf`)

Same config file, bind-mounted read-only into all three environments' `nginx` service. `nginx` is the only container publishing its environment's backend port to the host; `backend-a/b/c` are internal-only and only reachable through it. `nginx`'s `upstream backend_pool` lists all three by their fixed compose service names (not a scaled service — nginx's `upstream` block resolves hostnames once at config-load time, so a bare service name behind `docker compose --scale` wouldn't actually round-robin) and balances with `least_conn` plus passive health checks (`max_fails`/`fail_timeout`). The response header `X-Upstream-Addr` shows which replica served a given request — useful for confirming the balancing is real (`curl -sI http://localhost:8000/api/v1/docs`, or `:8080`/`:9000` for staging/prod).

This is where the Redis Pub/Sub design described below pays off: a `POST /messages/send` handled by `backend-b` publishes to Redis, and `backend-a`/`backend-c` each have their own listener task that delivers to *their* locally-connected sockets — so two users whose WebSocket connections land on different replicas (nginx doesn't guarantee session affinity, and none is needed) still see messages in real time. Migrations run once via the separate `migrate` service specifically to avoid 3 replicas racing to apply `alembic upgrade head` concurrently on startup.

---

## Backend (`chat_with_fastapi/`)

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
- `app/core/` — config, DB session factory, JWT security, WebSocket manager (Redis-backed)
- `app/utils/translator.py` — i18n via `app/locales/{en,vi}.json`

**Data model summary:**
- `User` — UUID PK; `role`: `admin`/`user`; `is_active`, `is_online`, `last_seen_at`
- `Conversation` — UUID PK; `type`: `direct` | `group`
- `ConversationMember` — int PK; links users to conversations; `role`: `owner`/`admin`/`member`; `left_at` (soft-remove), `last_read_message_id` for read receipts
- `Message` — UUID PK; `type`: `text`/`image`/`video`/`file`/`mixed`/`system`; self-referential `reply_to_message_id`; composite index `(conversation_id, created_at)`
- `MessageAttachment` — int PK; files attached to a message
- `MessageRead` — int PK; fine-grained per-user read log

**Routes overview:**
- `auth.py` — `POST /auth/login` (OAuth2 password form → JWT)
- `user.py` — `POST /users/` (public registration), `GET /users/search?q=`, `GET|PUT /users/me`, `DELETE /users/disable/{id}`
- `conversation.py` — `GET /conversations`, `POST /conversations` (creates group, or reuses an existing direct conversation between the two users), `POST /conversations/{id}/members`
- `message.py` — `GET /messages/{conversation_id}` (paginated history via `before_id`), `POST /messages/send`, `GET /messages/{conversation_id}/reads` + `POST /messages/{conversation_id}/read` (read receipts, below), plus the two WebSocket endpoints below

**Messaging & WebSocket flow:**
- `POST /api/v1/messages/send` — saves `Message` + attachments, bumps `Conversation.updated_at`, then broadcasts `{"event": "new_message", "data": {...}}` twice: to conversation-room sockets via `manager.broadcast()` and to every member's user-level channel via `manager.notify_users()` (so members not currently viewing that conversation still get notified)
- `WS /api/v1/messages/ws/{conversation_id}?token=<jwt>` — validates token + conversation membership on connect; joins the conversation room
- **Read receipts ("seen")** use `ConversationMember.last_read_message_id` as a per-member *watermark* — "read up to here" — rather than a row per (message, user). That answers both "did they see it?" and, in a group, "who saw it?" in one row per member instead of growing with the message count, which is why the `MessageRead` table stays unused. `POST /messages/{id}/read` `{message_id}` advances it (never backwards — clients scrolled up through history would otherwise un-read messages), and broadcasts `{"event": "message_read", "data": {conversation_id, user_id, username, full_name, avatar_url, last_read_message_id}}` to the room only — unlike `send_message`, there is no user-channel fan-out, because a receipt only matters to someone currently looking at that conversation and anyone opening it later refetches `GET /reads` (fanning out would cost one Redis publish per member for something nobody would see). `MessageService.send()` also advances the sender's own watermark in the same transaction. Only a watermark that actually moved is broadcast. The frontend groups receipts by `last_read_message_id`, so each reader's avatar renders under the last message they read
- **Typing indicators** ride *up* the same room socket — the only frames a client sends. `{"event": "typing", "data": {"is_typing": true|false}}` is broadcast back out to the room as `{"event": "typing", "data": {conversation_id, user_id, username, full_name, avatar_url, is_typing}}` (the identity fields come straight off the `User` already loaded for the socket's auth check, so the client can render an avatar without a second lookup), with `broadcast(..., exclude_user_id=...)` skipping the sender's own sockets. Anything else sent up the socket (including non-JSON keepalives) is ignored rather than closing the connection. A disconnect auto-broadcasts `is_typing: false`, since a client that closes mid-typing never gets to retract it; the frontend additionally expires a stale flag after `TYPING_TTL_MS` (`chatStore.ts`) in case even that is lost
- `WS /api/v1/messages/ws/user/me?token=<jwt>` — user-level channel that receives `new_message` events for every conversation the user belongs to (used to update the sidebar/unread state outside the currently open conversation)

**Realtime architecture (Redis Pub/Sub):** `app/core/websocket.py`'s singleton `ConnectionManager` keeps locally-connected sockets in per-process dicts (`_rooms`: `conversation_id → [(user_id, WebSocket)]`, `_users`: `user_id → [WebSocket]`), but `broadcast()`/`notify_user()` never write to those sockets directly — they `PUBLISH` a JSON envelope (`{"scope": "room"|"user", "target": ..., "payload": ...}`) to a single Redis channel (`ws:events`). A background task (started in `main.py`'s `lifespan`) subscribes to that channel and delivers to whichever local sockets match, in *every* running process. That listener is the *only* thing delivering realtime events in its process and nothing restarts it, so its loop deliberately swallows and logs per-event exceptions — an escaping error would silently kill every WebSocket update until the process restarts. Relatedly, the delivery helpers prune dead sockets by rebuilding the list rather than `list.remove()`: a socket's own `disconnect()` can prune it first while a send is awaiting, and `remove()` would then raise on the missing entry. This is what lets a message sent to any uvicorn worker/replica reach sockets connected to any other worker/replica — the connection manager is no longer single-process-only, which is what makes horizontally scaling the backend behind a load balancer possible.

**Auth:** `POST /api/v1/auth/login` accepts `OAuth2PasswordRequestForm`, returns JWT. `get_current_user` dep decodes token and loads `User` each request.

**Bootstrapping the DB schema:** `python -m app.init_data` calls `init_db()` to create all tables directly from the SQLAlchemy metadata — an alternative to `alembic upgrade head` for a fresh throwaway DB (Alembic migrations remain the source of truth otherwise).

**Windows async fix:** `app/core/database.py` sets `WindowsSelectorEventLoopPolicy` on `win32` — required for `aiomysql`.

**Error tracking (Sentry):** gated entirely on `SENTRY_DSN` (`app/core/config.py`) being set — unset (the default) means `sentry_sdk.init()` in `main.py` never runs, so dev stays silent unless you opt in. `release` is set to `settings.APP_VERSION` (the same VERSION-file-driven value used everywhere else), `environment` to `SENTRY_ENVIRONMENT` (`development`/`staging`/`production`, defaulted per compose file). FastAPI/Starlette/SQLAlchemy/Redis integrations are auto-detected — no explicit `integrations=[...]` list needed. Frontend mirrors this: `VITE_SENTRY_DSN` gates `Sentry.init()` in `main.tsx`, same `release`/`environment` convention, plus a `Sentry.ErrorBoundary` wrapping `<App />` for uncaught render errors.

**Tests:** `chat_with_fastapi/tests/services/` — unit tests for the service layer, using `unittest.mock.MagicMock(spec=AsyncSession)` (see `tests/conftest.py`'s `mock_db`/`make_result` fixtures). `chat_with_fastapi/tests/api/test_typing_events.py` covers what sits outside that layer: the WebSocket frame parser and the connection manager's room delivery (sender exclusion, dead-socket pruning). No real database required; run via `make test` / `pytest` (coverage configured in `pytest.ini`).

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

`.env` (already provided):
```
VITE_API_URL=http://localhost:8000/api/v1
VITE_WS_URL=ws://localhost:8000/api/v1
```

### Frontend architecture

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + Zustand + Axios + React Router v7 + Vitest + Testing Library

**Design tokens** (defined in `src/index.css` via `@theme`):
- Primary: `#AEE2FF` — used for message bubbles (sent), active states, avatar backgrounds, buttons
- Secondary: `#FCF8F8` — used for page/sidebar backgrounds

Use `bg-primary`, `bg-secondary`, `text-primary` etc. (Tailwind utility classes wired to these tokens).

**Dark/light theme:** separate from the tokens above — `src/index.css` defines a second layer of CSS custom properties (`--bg-base`, `--bg-surface`, `--text-primary`, etc.) under `:root` (light) and `.dark` (dark), with `@custom-variant dark (&:where(.dark, .dark *))`. `src/stores/themeStore.ts` (Zustand, persisted) holds `theme: 'dark' | 'light'` and toggles the `.dark` class on `<html>`; `App.tsx` applies it on mount via `applyTheme()`. `src/components/ui/ThemeToggle.tsx` is the UI control.

**State management (Zustand):**
- `src/stores/authStore.ts` — `token`, `user`; `login()`, `logout()`, `fetchMe()`; persisted to `localStorage` via `zustand/middleware persist`
- `src/stores/chatStore.ts` — `conversations`, `activeConversationId`, `messages` (keyed by `conversation_id`), `typing` (`conversation_id → TypingUser[]`, excluding yourself), `ws`; `connectWs()` opens a WebSocket and wires `new_message` events to `receiveMessage()` and `typing` events to `receiveTyping()`; `sendMessage()` calls the REST API and deduplicates against incoming WS events; `sendTyping()` pushes your own typing state up the room socket (throttled by `MessageInput`, which re-announces at most every 2.5s and retracts after 2.5s idle); `reads` (`conversation_id → ReadReceipt[]`) plus `fetchReads`/`receiveRead`/`markRead` hold read watermarks, with `markedRead` collapsing the repeat `markRead` calls that fire as messages arrive while a conversation stays open
- `src/stores/themeStore.ts` — see above

**File layout:**
- `src/api/` — thin Axios wrappers (`client.ts` adds the Bearer token interceptor, `auth.ts`, `users.ts`, `messages.ts`, `conversations.ts`)
- `src/types/index.ts` — all shared TypeScript interfaces (`User`, `Message`, `Conversation`, `Attachment`, etc.)
- `src/hooks/useDebounce.ts` — used to debounce the user-search input
- `src/components/ui/` — reusable primitives (`Avatar`, `ThemeToggle`)
- `src/components/chat/` — feature components (`ConversationList`, `ChatWindow`, `MessageBubble`, `MessageInput`, `TypingIndicator` + its `typingLabel` helper, `ReadReceipts`, `AddMembersModal`, `CreateGroupModal`, `UserSearchDropdown`). `TypingIndicator` renders *outside* `ChatWindow`'s scroll container, pinned between it and `MessageInput`, so it stays at the bottom of the chat frame regardless of message count or scroll position
- `src/pages/` — route-level pages (`LoginPage`, `RegisterPage`, `ChatPage`)
- `src/App.tsx` — `BrowserRouter` + `RequireAuth`/`RedirectIfAuth` guards; routes: `/login`, `/register`, `/`

**Tests:** co-located `*.test.tsx`/`*.test.ts` files next to the code they cover (e.g. `ConversationList.test.tsx`, `MessageBubble.test.tsx`, `MessageInput.test.tsx`, `Avatar.test.tsx`, `useDebounce.test.ts`, `authStore.test.ts`, `chatStore.test.ts`), run with Vitest + Testing Library + jsdom.

---

## End-to-end tests (`e2e/`)

Playwright specs that drive the real frontend + backend together (not mocked). Run from inside `e2e/`:

```bash
npm install
npm run test        # playwright test
npm run test:ui     # playwright test --ui
```

`playwright.config.ts` starts the stack itself via `webServer: { command: 'docker compose up -d', cwd: '..' }` and waits on `http://localhost:5173`. **`workers: 1`** is intentional — the target is a single dev-mode `uvicorn --reload` process, not a scaled multi-worker backend, and running specs concurrently was flaking it under load.

- `helpers/users.ts` — API-level fixtures (`registerUser`, `loginUser`, `createDirectConversation`) that set up test data directly via the backend REST API, skipping the UI where it isn't the thing under test
- `helpers/ui.ts` — UI-driven helpers (`loginViaUI`)
- `tests/auth.spec.ts` — register, log out, log back in, reject wrong credentials
- `tests/messaging.spec.ts` — start a direct conversation, send a message, survives reload
- `tests/groups.spec.ts` — create a group, send a message, add another member
- `tests/realtime.spec.ts` — a message sent by one user appears live for another with no reload (exercises the WebSocket/Redis pub-sub path end-to-end)
- `tests/read-receipts.spec.ts` — a direct message flips to "Seen" live when the recipient opens the conversation, and a group message shows the avatar of the member who read it while a member who didn't stays absent
- `tests/typing.spec.ts` — one user's typing shows up live for the other (and is never echoed to the sender), clearing both when the input is emptied and when the message is sent
