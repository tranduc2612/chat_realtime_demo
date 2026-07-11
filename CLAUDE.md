# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

```
demo_chat_realtime/
├── chat_with_fastapi/   # Python backend (FastAPI)
└── chat_frontend/       # React frontend (Vite + TypeScript)
```

---

## Backend (`chat_with_fastapi/`)

All commands run from inside `chat_with_fastapi/`.

```bash
# Activate virtualenv (Windows)
venv\Scripts\activate

# Run the dev server
uvicorn app.main:app --reload

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
SECRET_KEY=your-secret-key
```

`DATABASE_SYNC_URL` is used by Alembic; `DATABASE_URL` (async) is used at runtime.

### Backend architecture

**Stack:** FastAPI + SQLAlchemy (async, `aiomysql`) + MySQL + Alembic + JWT (python-jose) + bcrypt

**Request flow:**
1. `app/main.py` — FastAPI app, CORS middleware, mounts `api_router` at `/api/v1`
2. `app/api/main.py` — aggregates route modules: auth, user, conversation, message
3. `app/api/deps.py` — `CurrentUser` (JWT → User), `Language` (from `Accept-Language` header)
4. Routes call service classes; services hold an `AsyncSession`

**Layer conventions:**
- `app/models/` — SQLAlchemy ORM models (source of truth for schema)
- `app/schemas/` — Pydantic request/response models
- `app/services/` — business logic instantiated per-request with a DB session
- `app/api/routes/` — thin routers that wire HTTP → services
- `app/core/` — config, DB session factory, JWT security, WebSocket manager
- `app/utils/translator.py` — i18n via `app/locales/{en,vi}.json`

**Data model summary:**
- `Conversation` — `type`: `direct` | `group`; UUID PKs
- `ConversationMember` — links users to conversations; `role`: `owner`/`admin`/`member`; `last_read_message_id` for read receipts
- `Message` — `type`: `text`/`image`/`video`/`file`/`mixed`/`system`; self-referential `reply_to_message_id`; composite index `(conversation_id, created_at)`
- `MessageAttachment` — files attached to a message
- `MessageRead` — fine-grained per-user read log

**Messaging & WebSocket flow:**
- `POST /api/v1/messages/send` — saves `Message` + attachments, bumps `Conversation.updated_at`, broadcasts `{"event": "new_message", "data": {...}}` to all connected WebSocket clients in that conversation
- `WS /api/v1/messages/ws/{conversation_id}?token=<jwt>` — validates token + membership on connect; stays open receiving pings to keep alive
- `app/core/websocket.py` — singleton `ConnectionManager` maps `conversation_id → [(user_id, WebSocket)]`

**Auth:** `POST /api/v1/auth/login` accepts `OAuth2PasswordRequestForm`, returns JWT. `get_current_user` dep decodes token and loads `User` each request.

**Windows async fix:** `app/core/database.py` sets `WindowsSelectorEventLoopPolicy` on `win32` — required for `aiomysql`.

---

## Frontend (`chat_frontend/`)

All commands run from inside `chat_frontend/`.

```bash
npm install        # install dependencies
npm run dev        # dev server on http://localhost:5173
npm run build      # production build to dist/
npm run preview    # preview production build
```

### Frontend environment

`.env` (already provided):
```
VITE_API_URL=http://localhost:8000/api/v1
VITE_WS_URL=ws://localhost:8000/api/v1
```

### Frontend architecture

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + Zustand + Axios + React Router v7

**Design tokens** (defined in `src/index.css` via `@theme`):
- Primary: `#AEE2FF` — used for message bubbles (sent), active states, avatar backgrounds, buttons
- Secondary: `#FCF8F8` — used for page/sidebar backgrounds

Use `bg-primary`, `bg-secondary`, `text-primary` etc. (Tailwind utility classes wired to these tokens).

**State management (Zustand):**
- `src/stores/authStore.ts` — `token`, `user`; `login()`, `logout()`, `fetchMe()`; persisted to `localStorage` via `zustand/middleware persist`
- `src/stores/chatStore.ts` — `conversations`, `activeConversationId`, `messages` (keyed by `conversation_id`), `ws`; `connectWs()` opens a WebSocket and wires `new_message` events to `receiveMessage()`; `sendMessage()` calls the REST API and deduplicates against incoming WS events

**File layout:**
- `src/api/` — thin Axios wrappers (`client.ts` adds the Bearer token interceptor, `auth.ts`, `messages.ts`, `conversations.ts`)
- `src/types/index.ts` — all shared TypeScript interfaces (`User`, `Message`, `Conversation`, `Attachment`, etc.)
- `src/components/ui/` — reusable primitives (`Avatar`)
- `src/components/chat/` — feature components (`ConversationList`, `ChatWindow`, `MessageBubble`, `MessageInput`)
- `src/pages/` — route-level pages (`LoginPage`, `ChatPage`)
- `src/App.tsx` — `BrowserRouter` + `RequireAuth` guard; routes: `/login`, `/`
