# WebSocket service (`chat_with_fastapi_ws`)

The realtime half of the chat backend. Serves exactly two WebSocket endpoints and nothing else — no REST, no schema ownership, no token issuing. The HTTP API lives in [`../chat_with_fastapi`](../chat_with_fastapi) and is deployed separately.

## Why it's its own service

HTTP requests are short and CPU/DB-bound; WebSocket connections are long-lived and bound by memory and file descriptors. Separating them lets each scale on its own limit, and keeps a failure in one from taking the other down — with the API stopped, open sockets stay open and messages keep flowing; with this service stopped, the API still accepts and persists messages.

## Setup

**Prerequisites:** Python 3.12+, plus the *same* MySQL and Redis the HTTP API uses.

```bash
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
make dev      # uvicorn app.main:app --reload --port 8001
make test     # pytest — everything is mocked, no MySQL/Redis needed
```

Health check: `curl localhost:8001/health`. Swagger (endpoint list only): `localhost:8001/api/v1/docs`.

### Environment

```
DATABASE_URL=mysql+aiomysql://root:PASSWORD@localhost:3306/chat_realtime_demo
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=must-match-the-api
```

Only three settings matter, and **two of them must match the HTTP API exactly**:

- `REDIS_URL` — the same instance. This is the only path between the two services; a different Redis means messages published by the API never arrive here.
- `SECRET_KEY` (and `ALGORITHM`) — this service only *verifies* tokens the API issued. A mismatch rejects every socket with close code 4001, which surfaces in the browser as a bare handshake failure with no useful error. **Check this first when sockets fail and nothing else looks wrong.** Leaving both unset is fine locally: they then share the same default.

There is no `DATABASE_SYNC_URL` and no Alembic here — migrations belong to the API project, so there is no second migration runner to race with it.

## Endpoints

| | |
|---|---|
| `WS /api/v1/messages/ws/{conversation_id}?token=<jwt>` | Conversation room. Validates the token and membership on connect, then joins the room. |
| `WS /api/v1/messages/ws/user/me?token=<jwt>` | Session-level channel: `new_message` for every conversation the user belongs to, plus presence. Also the signal for "this user is online". |
| `GET /health` | Liveness. Deliberately does **not** touch MySQL or Redis — sockets survive a database blip, so failing this check on one would make an orchestrator restart the process and drop every connection for nothing. |

Paths match what the HTTP API used to serve, so clients change host and port only.

## What it does

**Delivers events published by the API.** `ConnectionManager` (`app/core/websocket.py`) keeps locally-connected sockets in per-process dicts (`_rooms`, `_users`) and subscribes to the Redis channel `ws:events`. Envelopes look like:

```json
{"scope": "room", "target": "<conversation_id>", "payload": {...}, "exclude": "<user_id>|null"}
```

`scope: "user"` targets a user id instead and takes no `exclude`. The API publishes these from `app/core/events.py`; both sides must agree on the shape.

The listener swallows and logs per-event errors rather than dying: it is the only thing delivering realtime events in its process and nothing restarts it, so an escaping exception would silently kill every update until a restart.

**Typing indicators.** These are the only frames a client sends *up* a socket: `{"event": "typing", "data": {"is_typing": true|false}}`, rebroadcast to the room with the sender excluded. Anything else sent up the socket — including non-JSON keepalives — is ignored rather than closing the connection. A disconnect auto-broadcasts `is_typing: false`, since a client that closes mid-typing never gets to retract it.

**Presence.** The session socket is the signal. Presence has to be *counted*, not flagged: a user with two tabs open, possibly on two replicas, must stay online when one closes. `PresenceTracker` (`app/core/presence.py`) keeps one Redis sorted set per user (`presence:{user_id}`) whose members are connection ids and scores the last heartbeat, and only broadcasts when a user actually crosses the online/offline boundary. Reads apply a TTL cutoff by score, so connections left behind by a replica that died without cleaning up stop counting on their own — no sweeper, no ghost "online" users.

## Layout

```
app/
├── main.py               # app + lifespan (starts the pub/sub listener), /health
├── api/routes/ws.py      # the two endpoints, typing broadcast, presence publishing
├── core/
│   ├── config.py         # settings
│   ├── database.py       # async engine + session factory
│   ├── security.py       # JWT verification (no hashing, no issuing)
│   ├── websocket.py      # ConnectionManager: socket registries + Redis listener
│   └── presence.py       # PresenceTracker: connection counting + heartbeats
└── db/queries.py         # every SQL statement this service issues — four of them
```

`db/queries.py` is deliberately explicit SQL rather than a copy of the API's ORM models. A second copy of six model files would be six files to keep in sync; these four statements are the whole dependency on the schema, so if the API renames a column the breakage is in one obvious place. The only write is `users.is_online` / `users.last_seen_at`.

## Tests

```bash
make test    # == pytest, coverage configured in pytest.ini
```

Covers the client-frame parser, room delivery (including sender exclusion and dead-socket pruning), presence counting, and the query mapping. Redis and the DB session are mocked, so no infrastructure is needed. The proof that the SQL matches the real schema is the e2e suite — [`../e2e/tests/`](../e2e/tests/) `typing`, `presence`, `read-receipts` and `realtime` drive both services against a live database and a real browser.
