import asyncio
import json
import logging
from collections import defaultdict

from fastapi import WebSocket
import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger(__name__)

CHANNEL = "ws:events"


def _contains(sockets: list[WebSocket], ws: WebSocket) -> bool:
    """Identity membership test — WebSocket doesn't define __eq__."""
    return any(s is ws for s in sockets)


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
                    # One bad envelope (or one socket that dies mid-send) must not
                    # take the listener down with it: this task is the only thing
                    # delivering realtime events in this process, and nothing
                    # restarts it, so an escaping exception would silently kill
                    # every WebSocket update until the process is restarted.
                    try:
                        envelope = json.loads(message["data"])
                        if envelope["scope"] == "room":
                            await self._deliver_room(
                                envelope["target"],
                                envelope["payload"],
                                envelope.get("exclude"),
                            )
                        else:
                            await self._deliver_user(envelope["target"], envelope["payload"])
                    except Exception:
                        logger.exception("Failed to deliver ws event, dropping it")
            except asyncio.CancelledError:
                raise
            except redis.ConnectionError:
                logger.warning("Redis pub/sub connection lost, retrying in 1s")
                await asyncio.sleep(1)
            except Exception:
                logger.exception("Redis pub/sub listener failed, restarting in 1s")
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

    async def broadcast(
        self,
        conversation_id: str,
        payload: dict,
        exclude_user_id: str | None = None,
    ) -> None:
        """Send `payload` to every socket in the room, in every process.

        `exclude_user_id` skips that user's own sockets — used by typing
        events, where echoing back to the sender is just noise.
        """
        try:
            await self._redis.publish(
                CHANNEL,
                json.dumps(
                    {
                        "scope": "room",
                        "target": conversation_id,
                        "payload": payload,
                        "exclude": exclude_user_id,
                    }
                ),
            )
        except redis.RedisError:
            logger.warning("Failed to publish room broadcast for conversation %s", conversation_id, exc_info=True)

    async def _deliver_room(
        self,
        conversation_id: str,
        payload: dict,
        exclude_user_id: str | None = None,
    ) -> None:
        dead: list[WebSocket] = []
        for uid, ws in list(self._rooms[conversation_id]):
            if exclude_user_id is not None and uid == exclude_user_id:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        if dead:
            # Filter rather than list.remove(): the socket's own disconnect
            # handler may have pruned it already while we were awaiting a send,
            # and remove() would raise ValueError for the missing entry.
            self._rooms[conversation_id] = [
                (uid, ws) for uid, ws in self._rooms[conversation_id] if not _contains(dead, ws)
            ]

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
        if dead:
            # Same disconnect race as _deliver_room — filter, don't remove()
            self._users[user_id] = [ws for ws in self._users[user_id] if not _contains(dead, ws)]

    async def notify_users(self, user_ids: list[str], payload: dict) -> None:
        for uid in user_ids:
            await self.notify_user(uid, payload)


manager = ConnectionManager()
