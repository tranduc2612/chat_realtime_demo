from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # conversation_id -> list of (user_id, websocket)
        self._rooms: dict[str, list[tuple[str, WebSocket]]] = defaultdict(list)
        # user_id -> list of websocket  (user-level channel)
        self._users: dict[str, list[WebSocket]] = defaultdict(list)

    # ── conversation-room helpers ──────────────────────────────────────────
    async def connect(self, conversation_id: str, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._rooms[conversation_id].append((user_id, ws))

    def disconnect(self, conversation_id: str, user_id: str, ws: WebSocket) -> None:
        self._rooms[conversation_id] = [
            (uid, conn)
            for uid, conn in self._rooms[conversation_id]
            if conn is not ws
        ]

    async def broadcast(self, conversation_id: str, payload: dict) -> None:
        dead: list[tuple[str, WebSocket]] = []
        for uid, ws in list(self._rooms[conversation_id]):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append((uid, ws))
        for item in dead:
            self._rooms[conversation_id].remove(item)

    # ── user-level channel helpers ─────────────────────────────────────────
    async def connect_user(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._users[user_id].append(ws)

    def disconnect_user(self, user_id: str, ws: WebSocket) -> None:
        self._users[user_id] = [c for c in self._users[user_id] if c is not ws]

    async def notify_user(self, user_id: str, payload: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._users[user_id]):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._users[user_id].remove(ws)

    async def notify_users(self, user_ids: list[str], payload: dict) -> None:
        for uid in user_ids:
            await self.notify_user(uid, payload)


manager = ConnectionManager()
