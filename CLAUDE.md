# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

```
chat_realtime_demo/
├── chat_with_fastapi/   # Python backend (FastAPI)
├── chat_frontend/       # React frontend (Vite + TypeScript)
├── e2e/                 # Playwright end-to-end tests (drives the two above)
├── nginx/nginx.conf     # Load balancer config (see below)
└── docker-compose.yml   # MySQL + Redis + migrate + 3x backend + nginx + frontend, one command
```

### Running the whole stack with Docker

From the repo root:

```bash
docker compose up
```

Brings up MySQL, Redis, a one-shot `migrate` service (`alembic upgrade head`, runs once and exits), **three backend replicas** (`backend-a`/`backend-b`/`backend-c`, each `uvicorn --reload`) behind an **nginx load balancer**, and the frontend (`vite --host 0.0.0.0`) — with source bind-mounted for live reload, no local Python/Node/MySQL/Redis install needed.

- Backend (via nginx): `http://localhost:8000` (docs at `/api/v1/docs`)
- Frontend: `http://localhost:5173`
- MySQL: `localhost:3306` (root/`12345678`, db `chat_realtime_demo`)
- Redis: `localhost:6379`

Container-specific env (`mysql`/`redis` hostnames, etc.) is injected via `docker-compose.yml`'s `environment:` block, not by editing `.env` — local (non-Docker) dev via `make dev`/`npm run dev` is unaffected and keeps using the `.env` files below. MySQL data persists in a named volume (`docker compose down -v` to wipe it).

#### Load balancing (`nginx/nginx.conf`)

`nginx` is the only container publishing port 8000 to the host; `backend-a/b/c` are internal-only and only reachable through it. Balancing happens at **Layer 4** — `nginx.conf`'s `stream {}` block (not `http {}`) accepts a raw TCP connection on 8000 and relays bytes to whichever backend it picks; it never parses HTTP, so there's no request/response header it can inject to show which replica served a request. `upstream backend_pool` lists all three by their fixed compose service names (not a scaled service — nginx resolves hostnames once at config-load time, so a bare service name behind `docker compose --scale` wouldn't actually round-robin) and balances with the default round-robin algorithm plus passive health checks (`max_fails`/`fail_timeout`). To confirm balancing is real, watch nginx's own connection log (`docker compose logs -f nginx`) — it logs `$upstream_addr` per connection, and rotates across all three IPs.

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
- `message.py` — `GET /messages/{conversation_id}` (paginated history via `before_id`), `POST /messages/send`, plus the two WebSocket endpoints below

**Messaging & WebSocket flow:**
- `POST /api/v1/messages/send` — saves `Message` + attachments, bumps `Conversation.updated_at`, then broadcasts `{"event": "new_message", "data": {...}}` twice: to conversation-room sockets via `manager.broadcast()` and to every member's user-level channel via `manager.notify_users()` (so members not currently viewing that conversation still get notified)
- `WS /api/v1/messages/ws/{conversation_id}?token=<jwt>` — validates token + conversation membership on connect; joins the conversation room
- `WS /api/v1/messages/ws/user/me?token=<jwt>` — user-level channel that receives `new_message` events for every conversation the user belongs to (used to update the sidebar/unread state outside the currently open conversation)

**Realtime architecture (Redis Pub/Sub):** `app/core/websocket.py`'s singleton `ConnectionManager` keeps locally-connected sockets in per-process dicts (`_rooms`: `conversation_id → [(user_id, WebSocket)]`, `_users`: `user_id → [WebSocket]`), but `broadcast()`/`notify_user()` never write to those sockets directly — they `PUBLISH` a JSON envelope (`{"scope": "room"|"user", "target": ..., "payload": ...}`) to a single Redis channel (`ws:events`). A background task (started in `main.py`'s `lifespan`) subscribes to that channel and delivers to whichever local sockets match, in *every* running process. This is what lets a message sent to any uvicorn worker/replica reach sockets connected to any other worker/replica — the connection manager is no longer single-process-only, which is what makes horizontally scaling the backend behind a load balancer possible.

**Auth:** `POST /api/v1/auth/login` accepts `OAuth2PasswordRequestForm`, returns JWT. `get_current_user` dep decodes token and loads `User` each request.

**Bootstrapping the DB schema:** `python -m app.init_data` calls `init_db()` to create all tables directly from the SQLAlchemy metadata — an alternative to `alembic upgrade head` for a fresh throwaway DB (Alembic migrations remain the source of truth otherwise).

**Windows async fix:** `app/core/database.py` sets `WindowsSelectorEventLoopPolicy` on `win32` — required for `aiomysql`.

**Tests:** `chat_with_fastapi/tests/services/` — unit tests for the service layer, using `unittest.mock.MagicMock(spec=AsyncSession)` (see `tests/conftest.py`'s `mock_db`/`make_result` fixtures). No real database required; run via `make test` / `pytest` (coverage configured in `pytest.ini`).

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
- `src/stores/chatStore.ts` — `conversations`, `activeConversationId`, `messages` (keyed by `conversation_id`), `ws`; `connectWs()` opens a WebSocket and wires `new_message` events to `receiveMessage()`; `sendMessage()` calls the REST API and deduplicates against incoming WS events
- `src/stores/themeStore.ts` — see above

**File layout:**
- `src/api/` — thin Axios wrappers (`client.ts` adds the Bearer token interceptor, `auth.ts`, `users.ts`, `messages.ts`, `conversations.ts`)
- `src/types/index.ts` — all shared TypeScript interfaces (`User`, `Message`, `Conversation`, `Attachment`, etc.)
- `src/hooks/useDebounce.ts` — used to debounce the user-search input
- `src/components/ui/` — reusable primitives (`Avatar`, `ThemeToggle`)
- `src/components/chat/` — feature components (`ConversationList`, `ChatWindow`, `MessageBubble`, `MessageInput`, `AddMembersModal`, `CreateGroupModal`, `UserSearchDropdown`)
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
