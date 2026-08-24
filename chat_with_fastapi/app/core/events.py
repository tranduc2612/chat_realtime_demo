"""Publishing realtime events to the WebSocket service.

This project holds no sockets — `chat_with_fastapi_ws` does. All it needs is to
PUBLISH, which requires no subscription and no connection registry.

The envelope below is a **contract shared with that service**; both sides must
agree on it. Its consumer is `app/core/websocket.py` there:

    {"scope": "room" | "user",
     "target": conversation_id | user_id,
     "payload": {...},          # delivered verbatim to the client
     "exclude": user_id | None} # room scope only: skip this user's own sockets
"""
import json
import logging

import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger(__name__)

CHANNEL = "ws:events"


class EventPublisher:
    def __init__(self) -> None:
        self._redis: redis.Redis = redis.from_url(settings.REDIS_URL, decode_responses=True)

    async def close(self) -> None:
        await self._redis.aclose()

    async def _publish(self, envelope: dict, what: str) -> None:
        try:
            await self._redis.publish(CHANNEL, json.dumps(envelope))
        except redis.RedisError:
            # Realtime delivery is best-effort: the message itself is already
            # committed, so a Redis blip must not fail the HTTP request.
            logger.warning("Failed to publish %s", what, exc_info=True)

    async def broadcast(
        self,
        conversation_id: str,
        payload: dict,
        exclude_user_id: str | None = None,
    ) -> None:
        """Send to every socket in a conversation room, on any ws replica."""
        await self._publish(
            {
                "scope": "room",
                "target": conversation_id,
                "payload": payload,
                "exclude": exclude_user_id,
            },
            f"room broadcast for conversation {conversation_id}",
        )

    async def notify_user(self, user_id: str, payload: dict) -> None:
        """Send to a user's session-level sockets, wherever they are connected."""
        await self._publish(
            {"scope": "user", "target": user_id, "payload": payload},
            f"user notification for user {user_id}",
        )

    async def notify_users(self, user_ids: list[str], payload: dict) -> None:
        for user_id in user_ids:
            await self.notify_user(user_id, payload)


events = EventPublisher()
