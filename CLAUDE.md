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
- `app/core/websocket.py` — singleton `ConnectionManager` keeps both `conversation_id → [(user_id, WebSocket)]` (rooms) and `user_id → [WebSocket]` (user channels)

**Auth:** `POST /api/v1/auth/login` accepts `OAuth2PasswordRequestForm`, returns JWT. `get_current_user` dep decodes token and loads `User` each request.

**Bootstrapping the DB schema:** `python -m app.init_data` calls `init_db()` to create all tables directly from the SQLAlchemy metadata — an alternative to `alembic upgrade head` for a fresh throwaway DB (Alembic migrations remain the source of truth otherwise).

**Windows async fix:** `app/core/database.py` sets `WindowsSelectorEventLoopPolicy` on `win32` — required for `aiomysql`.

**No automated test suite** currently exists in this repo.

---

## Frontend (`chat_frontend/`)

All commands run from inside `chat_frontend/`.

```bash
npm install        # install dependencies
npm run dev        # dev server on http://localhost:5173
npm run build      # production build to dist/ (runs tsc -b first)
npm run preview    # preview production build
npm run lint       # eslint
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
