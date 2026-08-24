"""Reading who is online.

Presence is *written* by the WebSocket service (`chat_with_fastapi_ws`), which
owns the connections; this project only reads it, to fill in `is_online` on
conversation members and user search results.

The Redis layout is a **contract shared with that service** — one sorted set per
user, `presence:{user_id}`, members being connection ids and scores their last
heartbeat. Both sides must agree on the key format *and* on
CONNECTION_TTL_SECONDS: this side uses it as the cutoff for "still alive", that
side refreshes scores well inside it.
"""
import logging
import time

import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# Must match chat_with_fastapi_ws/app/core/presence.py
CONNECTION_TTL_SECONDS = 60


class PresenceReader:
    def __init__(self) -> None:
        self._redis: redis.Redis = redis.from_url(settings.REDIS_URL, decode_responses=True)

    def _key(self, user_id: str) -> str:
        return f"presence:{user_id}"

    async def close(self) -> None:
        await self._redis.aclose()

    async def online_among(self, user_ids: list[str]) -> set[str]:
        """Which of these users have a live connection right now.

        Counting by score cutoff rather than trusting a stored flag is what
        keeps a ws replica that died without cleaning up from leaving users
        "online" forever — its entries simply stop counting.
        """
        if not user_ids:
            return set()

        cutoff = time.time() - CONNECTION_TTL_SECONDS
        try:
            pipe = self._redis.pipeline()
            for user_id in user_ids:
                pipe.zcount(self._key(user_id), cutoff, "+inf")
            counts = await pipe.execute()
        except redis.RedisError:
            # Degrade to "nobody online" rather than failing the request
            logger.warning("Presence: lookup failed", exc_info=True)
            return set()

        return {user_id for user_id, count in zip(user_ids, counts) if count}


presence = PresenceReader()
