import asyncio
import json
import logging
from collections import defaultdict

from fastapi import WebSocket
import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger(__name__)

CHANNEL = "ws:events"


class ConnectionManager:
    def __init__(self):
        # conversation_id -> list of (user_id, websocket)  (local to this process)
        self._rooms: dict[str, list[tuple[str, WebSocket]]] = defaultdict(list)
        # user_id -> list of websocket  (user-level channel, local to this process)
        self._users: dict[str, list[WebSocket]] = defaultdict(list)

        self._redis: redis.Redis = redis.from_url(settings.REDIS_URL, decode_responses=True)
        self._listener_task: asyncio.Task | None = None

    # ── lifecycle ────────────────────────────────────────────────────────────
    async def start(self) -> None:
        self._listener_task = asyncio.create_task(self._listen())

    async def stop(self) -> None:
        if self._listener_task is not None:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        await self._redis.aclose()

    async def _listen(self) -> None:
        while True:
            try:
                pubsub = self._redis.pubsub()
                await pubsub.subscribe(CHANNEL)
                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue
                    envelope = json.loads(message["data"])
                    if envelope["scope"] == "room":
                        await self._deliver_room(envelope["target"], envelope["payload"])
                    else:
                        await self._deliver_user(envelope["target"], envelope["payload"])
            except asyncio.CancelledError:
                raise
            except redis.ConnectionError:
                logger.warning("Redis pub/sub connection lost, retrying in 1s")
                await asyncio.sleep(1)

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
        try:
            await self._redis.publish(
                CHANNEL,
                json.dumps({"scope": "room", "target": conversation_id, "payload": payload}),
            )
        except redis.RedisError:
            logger.warning("Failed to publish room broadcast for conversation %s", conversation_id, exc_info=True)

    async def _deliver_room(self, conversation_id: str, payload: dict) -> None:
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
        try:
            await self._redis.publish(
                CHANNEL,
                json.dumps({"scope": "user", "target": user_id, "payload": payload}),
            )
        except redis.RedisError:
            logger.warning("Failed to publish user notification for user %s", user_id, exc_info=True)

    async def _deliver_user(self, user_id: str, payload: dict) -> None:
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
