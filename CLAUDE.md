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
├── .env                       # dev secrets (gitignored — holds the real OPENAI_API_KEY)
└── .env.staging / .env.prod   # staging/prod secrets (gitignored — copy from the .example files)
```

### Environments (dev / staging / production)

Three independent, identically-shaped stacks (MySQL, Redis, ChromaDB, a one-shot `migrate` service, 3 backend replicas behind nginx, frontend), each runnable with a single `make` target and each on its own port range so **all three can run at once on one machine**:

| Env | Command | Backend (via nginx) | Frontend | MySQL/Redis/Chroma published? |
|---|---|---|---|---|
| dev | `make dev` (or bare `docker compose up`, e.g. from `e2e/`) | `:8000` | `:5173`, `vite dev` hot reload | yes (`:3306`/`:6379`/`:8100`) |
| staging | `make staging` | `:8080` | `:5174`, real `vite build`+`preview` | no, internal only |
| prod | `make prod` | `:9000` | `:5175`, real `vite build`+`preview` | no, internal only |

`docker-compose.yml` **is** the dev environment — bind-mounted source, `--reload`, hardcoded dev placeholder secrets, unchanged from before. `docker-compose.staging.yml`/`docker-compose.prod.yml` are separate, self-contained compose files (same shape, no bind mounts — they run whatever's baked into the image, closer to a real release build) driven by `.env.staging`/`.env.prod`. First-time setup for either: `cp .env.staging.example .env.staging` (and same for prod), fill in real values — the dev `.env` is fine as-is (its MySQL/JWT values are already public in `docker-compose.yml`) — note all three env files are gitignored, so real secrets belong in them and never in a `.example`, but the `.example` placeholders for staging/prod are **not** safe to run with as-is. `make {staging,prod}-down` tears each down without touching the others (`-p chat_realtime_demo_{staging,prod}` gives each its own container/network namespace, which is also what lets all three coexist).

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

# Create or promote an admin (required to upload RAG documents)
python -m app.create_admin --email me@corp.com --username me --password 's3cret!!'
```

API docs: `/api/v1/docs` (Swagger), `/api/v1/redoc`.

### Backend environment

Copy `.env.example` to `.env`:

```
DATABASE_URL=mysql+aiomysql://root:PASSWORD@localhost:3306/DB_NAME
DATABASE_SYNC_URL=mysql+pymysql://root:PASSWORD@localhost:3306/DB_NAME
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=your-secret-key
ALLOWED_ORIGINS=["http://localhost:5173"]

# RAG chatbot — optional, unset disables it (see the RAG chatbot section)
OPENAI_API_KEY=sk-...
CHROMA_HOST=localhost
CHROMA_PORT=8100
```

`DATABASE_SYNC_URL` is used by Alembic; `DATABASE_URL` (async) is used at runtime. `ALLOWED_ORIGINS` (CORS, consumed by the `CORSMiddleware` in `main.py`) is a **JSON array** — pydantic-settings parses complex types with `json.loads`, so a bare comma-separated string won't work. It has no hardcoded default: unset means no browser origin is allowed, which is why every environment declares it (`.env`/`.env.staging`/`.env.prod` at the repo root for the Docker stacks, `chat_with_fastapi/.env` for the non-Docker `make dev`). `REDIS_URL` defaults to `redis://localhost:6379/0` if unset, but **a reachable Redis server is required at app startup** — `ConnectionManager` publishes/subscribes through it and the app won't come up without it (`brew install redis && brew services start redis` locally, or use `docker compose up`). Chroma is the opposite: it's connected to lazily on the first RAG request, so an unreachable vector store degrades `/chat-bot` without affecting startup or any other route. For a non-Docker `make dev` against the Docker stack, point `CHROMA_PORT` at the published dev port (`8100`).

### Backend architecture

**Stack:** FastAPI + SQLAlchemy (async, `aiomysql`) + MySQL + Redis (Pub/Sub) + ChromaDB + OpenAI + Alembic + JWT (python-jose) + bcrypt

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
- `app/core/` — config, DB session factory, JWT security, WebSocket manager (Redis-backed), OpenAI client (`llm.py`), Chroma client (`vectorstore.py`)
- `app/utils/translator.py` — i18n via `app/locales/{en,vi}.json`
- `app/utils/document_parser.py` — pure text extraction + chunking for the RAG knowledge base

**Data model summary:**
- `User` — UUID PK; `role`: `admin`/`user`; `is_active`, `is_online`, `last_seen_at`
- `Conversation` — UUID PK; `type`: `direct` | `group`
- `ConversationMember` — int PK; links users to conversations; `role`: `owner`/`admin`/`member`; `left_at` (soft-remove), `last_read_message_id` for read receipts
- `Message` — UUID PK; `type`: `text`/`image`/`video`/`file`/`mixed`/`system`; self-referential `reply_to_message_id`; composite index `(conversation_id, created_at)`
- `MessageAttachment` — int PK; files attached to a message
- `MessageRead` — int PK; fine-grained per-user read log
- `Document` — UUID PK; uploaded internal document *metadata* only (`status`: `pending`/`processing`/`ready`/`failed`, `chunk_count`, `error`); the chunks and vectors live in ChromaDB
- `BotConversation` / `BotMessage` — UUID PKs; the RAG chatbot's own history, separate from human chat (`role`: `user`/`assistant`, `citations` JSON, `model`, token counts)

**Routes overview:**
- `auth.py` — `POST /auth/login` (OAuth2 password form → JWT)
- `user.py` — `POST /users/` (public registration), `GET /users/search?q=`, `GET|PUT /users/me`, `DELETE /users/disable/{id}`
- `conversation.py` — `GET /conversations`, `POST /conversations` (creates group, or reuses an existing direct conversation between the two users), `POST /conversations/{id}/members`
- `message.py` — `GET /messages/{conversation_id}` (paginated history via `before_id`), `POST /messages/send`, plus the two WebSocket endpoints below
- `document.py` / `bot.py` — the RAG chatbot's knowledge base and chat endpoints; see the RAG chatbot section below

**Messaging & WebSocket flow:**
- `POST /api/v1/messages/send` — saves `Message` + attachments, bumps `Conversation.updated_at`, then broadcasts `{"event": "new_message", "data": {...}}` twice: to conversation-room sockets via `manager.broadcast()` and to every member's user-level channel via `manager.notify_users()` (so members not currently viewing that conversation still get notified)
- `WS /api/v1/messages/ws/{conversation_id}?token=<jwt>` — validates token + conversation membership on connect; joins the conversation room
- `WS /api/v1/messages/ws/user/me?token=<jwt>` — user-level channel that receives `new_message` events for every conversation the user belongs to (used to update the sidebar/unread state outside the currently open conversation)

**Realtime architecture (Redis Pub/Sub):** `app/core/websocket.py`'s singleton `ConnectionManager` keeps locally-connected sockets in per-process dicts (`_rooms`: `conversation_id → [(user_id, WebSocket)]`, `_users`: `user_id → [WebSocket]`), but `broadcast()`/`notify_user()` never write to those sockets directly — they `PUBLISH` a JSON envelope (`{"scope": "room"|"user", "target": ..., "payload": ...}`) to a single Redis channel (`ws:events`). A background task (started in `main.py`'s `lifespan`) subscribes to that channel and delivers to whichever local sockets match, in *every* running process. This is what lets a message sent to any uvicorn worker/replica reach sockets connected to any other worker/replica — the connection manager is no longer single-process-only, which is what makes horizontally scaling the backend behind a load balancer possible.

**Auth:** `POST /api/v1/auth/login` accepts `OAuth2PasswordRequestForm`, returns JWT. `get_current_user` dep decodes token and loads `User` each request.

**Bootstrapping the DB schema:** `python -m app.init_data` calls `init_db()` to create all tables directly from the SQLAlchemy metadata — an alternative to `alembic upgrade head` for a fresh throwaway DB (Alembic migrations remain the source of truth otherwise).

**Windows async fix:** `app/core/database.py` sets `WindowsSelectorEventLoopPolicy` on `win32` — required for `aiomysql`.

**Error tracking (Sentry):** gated entirely on `SENTRY_DSN` (`app/core/config.py`) being set — unset (the default) means `sentry_sdk.init()` in `main.py` never runs, so dev stays silent unless you opt in. `release` is set to `settings.APP_VERSION` (the same VERSION-file-driven value used everywhere else), `environment` to `SENTRY_ENVIRONMENT` (`development`/`staging`/`production`, defaulted per compose file). FastAPI/Starlette/SQLAlchemy/Redis integrations are auto-detected — no explicit `integrations=[...]` list needed. Frontend mirrors this: `VITE_SENTRY_DSN` gates `Sentry.init()` in `main.tsx`, same `release`/`environment` convention, plus a `Sentry.ErrorBoundary` wrapping `<App />` for uncaught render errors.

**Tests:** `chat_with_fastapi/tests/services/` and `tests/utils/` — unit tests for the service layer and the document parser, using `unittest.mock.MagicMock(spec=AsyncSession)` (see `tests/conftest.py`'s `mock_db`/`make_result` fixtures). No real database, OpenAI key, or Chroma server required — the RAG tests patch `embed_texts`/`vector_store`/`get_openai`. Run via `make test` / `pytest` (coverage configured in `pytest.ini`).

---

## RAG chatbot (`/chat-bot`)

An internal-documents assistant: admins upload documents, any user asks questions on the `/chat-bot` page, and answers are generated **only** from the retrieved document chunks, with citations. It is retrieval-augmented, **not** fine-tuned — the model is never trained on the documents; they're retrieved fresh per question, so uploading, editing or deleting one takes effect on the very next answer. Everything is gated on `OPENAI_API_KEY`: unset (the default) means `/api/v1/bot/*` and `/api/v1/documents/*` return **503** and the rest of the app is completely unaffected, exactly like `SENTRY_DSN` gates Sentry.

**Enabling it:** set `OPENAI_API_KEY` in the environment's env file — `.env` for dev, `.env.staging`/`.env.prod` for the others. All three are gitignored (`.gitignore` ignores `.env` and `.env.*`, un-ignoring only the two `.example` files), so a real key is safe there and must never be moved into a `.example`. Then create an admin, since public registration only ever makes `user` accounts and uploading is admin-only:

```bash
docker compose exec backend-a python -m app.create_admin \
  --email me@corp.com --username me --password 's3cret!!'
```

Re-running that against an existing email/username promotes that account instead of failing, so it doubles as "make this person an admin".

**Storage split.** MySQL holds metadata and history (`documents`, `bot_conversations`, `bot_messages` — migration `b7f2c41d8a03`); **ChromaDB holds the vectors**. `bot_*` tables are deliberately separate from `conversations`/`messages`: a bot thread has one human member (no membership table, no read receipts, no WebSocket broadcast) and carries per-turn RAG metadata (`citations` JSON, `model`, token counts) that means nothing for human chat.

Chroma runs as its **own service** in all three compose files (`chromadb/chroma:1.5.9`, pinned to match `chromadb-client` in `requirements.txt`), not as an embedded `PersistentClient` — three backend replicas writing one SQLite file would race. `app/core/vectorstore.py` connects lazily via `chromadb.AsyncHttpClient` behind an `asyncio.Lock`, so a cold worker doesn't build three clients at once, and `reset_cache()` drops the handles after a failure so one bad request doesn't poison the worker. The collection is created with `embedding_function: None` and cosine space — embeddings always come from OpenAI, Chroma never computes any. Chunk ids are deterministic (`<document-id>:<n>`), so re-ingesting a document overwrites rather than duplicates.

**Ingestion** (`app/utils/document_parser.py` + `app/services/document_service.py`): `POST /api/v1/documents` (admin, multipart) validates extension and size, records a `pending` row, and returns immediately — parsing/chunking/embedding happens in a `BackgroundTask` that opens its **own** DB session and flips the row to `ready` or `failed` (the UI polls). Uploaded bytes are parsed straight from the request and never written to disk, so there's no upload volume to share between replicas. Supported: `.pdf` (pypdf), `.docx` (python-docx, including table cells — internal docs keep a lot of detail there), `.html`/`.htm` (bs4, script/style stripped), `.md`/`.markdown`/`.txt`. Chunking is paragraph-aware with a character overlap carried from the previous chunk (so an answer straddling a boundary stays retrievable); over-long paragraphs are split at whitespace, and text with no whitespace at all is hard-cut rather than emitted as one oversized blob. Every ingest failure is caught and recorded on the row — a background task that raised would leave the document stuck at `processing` forever.

**Retrieval + generation** (`app/services/rag_service.py`): embed the question → query Chroma for `RAG_TOP_K` chunks → **drop anything past `RAG_MAX_DISTANCE`** (cosine, 0 = identical, 2 = opposite) → build `system rules + recent history + numbered sources + question`. If nothing survives the distance filter the model is **never called** — the endpoint returns a fixed "not covered by the internal documents" reply, which is the main defence against confident invention. Lower `RAG_MAX_DISTANCE` to make it stricter, raise it if it declines too eagerly.

**Streaming.** `POST /api/v1/bot/conversations/{id}/ask` returns SSE: one `citations` event, then `delta` events, then a terminal `done` (or an in-band `error`). Two non-obvious constraints:
- The generator opens its **own** `AsyncSessionLocal()` to persist the answer — FastAPI closes `Depends(get_db)` sessions *before* a streaming body is sent, so the route's `db` is already unusable inside the generator. Retrieval therefore happens in the route (real HTTP errors) and only generation is streamed (in-band `error` events, since the status code is already committed once bytes flow).
- The response sets `X-Accel-Buffering: no`; without it nginx would buffer the whole answer and streaming would read as a long stall. `nginx.conf` keeps buffering on for normal JSON responses and lets this endpoint opt out per-response.

**Routes:**
- `POST|GET /api/v1/documents`, `DELETE /api/v1/documents/{id}` — admin only (`AdminUser` dep). Delete removes vectors from Chroma *before* the MySQL row, so a Chroma failure leaves the document listed and still deletable rather than stranding orphaned chunks.
- `GET /api/v1/documents/stats` — any signed-in user; counts + `vector_store_ready`. Deliberately not LLM-gated, because the page needs it precisely when the assistant is unavailable.
- `GET|POST /api/v1/bot/conversations`, `DELETE .../{id}`, `GET .../{id}/messages`, `POST .../{id}/ask` — all scoped to the calling user (a bot thread is private; the `user_id` predicate is in the query itself).

**Frontend** (`src/pages/ChatBotPage.tsx`, `src/components/bot/`, `src/stores/botStore.ts`): `/chat-bot`, reachable from the "Internal Assistant" link in the main chat sidebar. `src/api/bot.ts`'s `askBot` uses `fetch` + `ReadableStream` rather than the shared axios client (XHR can't expose a body incrementally) and rather than `EventSource` (which can't send an `Authorization` header); it reassembles SSE frames split across reads. The store shows the question optimistically plus a streaming draft bubble, then swaps the draft's placeholder id for the persisted one on `done` so a refetch doesn't duplicate it. A partial answer is kept on error or when the user hits Stop (`AbortController`). `MarkdownLite.tsx` is a small dependency-free renderer for the subset of Markdown the system prompt asks for — it builds React elements directly and never uses `dangerouslySetInnerHTML`, so model output can't inject markup; `[n]` markers become clickable chips that open the source list. The knowledge-base panel is admin-only in the UI (`user.role === 'admin'`, which is why `UserResponse` now exposes `role`) — the API enforces it server-side regardless.

**Config** (all in `app/core/config.py`, documented in `.env.example`): `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL` (default `gpt-4o-mini`), `OPENAI_EMBEDDING_MODEL`/`OPENAI_EMBEDDING_DIMENSIONS`, `CHROMA_HOST`/`CHROMA_PORT`/`CHROMA_COLLECTION`, `RAG_CHUNK_SIZE`/`RAG_CHUNK_OVERLAP`/`RAG_TOP_K`/`RAG_MAX_DISTANCE`/`RAG_MAX_HISTORY`/`RAG_MAX_UPLOAD_MB`. **Changing the embedding model or dimensions invalidates every stored vector** — Chroma collections are fixed-width, so delete the collection and re-upload all documents.

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
- `src/stores/botStore.ts` — RAG chatbot threads, streamed answers, knowledge-base stats (see the RAG chatbot section above)
- `src/stores/themeStore.ts` — see above

**File layout:**
- `src/api/` — thin Axios wrappers (`client.ts` adds the Bearer token interceptor, `auth.ts`, `users.ts`, `messages.ts`, `conversations.ts`)
- `src/types/index.ts` — all shared TypeScript interfaces (`User`, `Message`, `Conversation`, `Attachment`, etc.)
- `src/hooks/useDebounce.ts` — used to debounce the user-search input
- `src/components/ui/` — reusable primitives (`Avatar`, `ThemeToggle`)
- `src/components/chat/` — feature components (`ConversationList`, `ChatWindow`, `MessageBubble`, `MessageInput`, `AddMembersModal`, `CreateGroupModal`, `UserSearchDropdown`)
- `src/components/bot/` — RAG chatbot components (`BotConversationList`, `BotMessageBubble`, `BotComposer`, `KnowledgeBasePanel`, `MarkdownLite`) — see the RAG chatbot section above
- `src/pages/` — route-level pages (`LoginPage`, `RegisterPage`, `ChatPage`, `ChatBotPage`)
- `src/App.tsx` — `BrowserRouter` + `RequireAuth`/`RedirectIfAuth` guards; routes: `/login`, `/register`, `/`, `/chat-bot`

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
