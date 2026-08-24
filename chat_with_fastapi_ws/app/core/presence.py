import logging
import time

import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# A connection is assumed dead this long after its last heartbeat. Reads apply
# the cutoff by score, so entries left behind by a replica that crashed without
# running its disconnect path stop counting on their own — no sweeper needed.
CONNECTION_TTL_SECONDS = 60
# Comfortably under the TTL, so one dropped heartbeat doesn't flap the user offline
HEARTBEAT_INTERVAL_SECONDS = 20


class PresenceTracker:
    """Who is online right now, counted across tabs *and* backend replicas.

    One Redis sorted set per user (`presence:{user_id}`): members are
    connection ids, scores are the last heartbeat timestamp. A user is online
    while at least one member's score is newer than CONNECTION_TTL_SECONDS.
    Counting connections rather than storing a boolean is what makes closing
    one of two open tabs *not* report the user offline.
    """

    def __init__(self) -> None:
        self._redis: redis.Redis = redis.from_url(settings.REDIS_URL, decode_responses=True)

    def _key(self, user_id: str) -> str:
        return f"presence:{user_id}"

    async def close(self) -> None:
        await self._redis.aclose()

    async def connected(self, user_id: str, connection_id: str) -> bool:
        """Register a connection. True when the user *became* online."""
        now = time.time()
        try:
            pipe = self._redis.pipeline()
            pipe.zremrangebyscore(self._key(user_id), "-inf", now - CONNECTION_TTL_SECONDS)
            pipe.zcard(self._key(user_id))
            pipe.zadd(self._key(user_id), {connection_id: now})
            pipe.expire(self._key(user_id), CONNECTION_TTL_SECONDS * 2)
            _, live_before, _, _ = await pipe.execute()
        except redis.RedisError:
            logger.warning("Presence: failed to register %s", user_id, exc_info=True)
            return False
        return live_before == 0

    async def heartbeat(self, user_id: str, connection_id: str) -> None:
        try:
            pipe = self._redis.pipeline()
            pipe.zadd(self._key(user_id), {connection_id: time.time()})
            pipe.expire(self._key(user_id), CONNECTION_TTL_SECONDS * 2)
            await pipe.execute()
        except redis.RedisError:
            logger.warning("Presence: heartbeat failed for %s", user_id, exc_info=True)

    async def disconnected(self, user_id: str, connection_id: str) -> bool:
        """Drop a connection. True when that was the user's last one."""
        now = time.time()
        try:
            pipe = self._redis.pipeline()
            pipe.zrem(self._key(user_id), connection_id)
            pipe.zremrangebyscore(self._key(user_id), "-inf", now - CONNECTION_TTL_SECONDS)
            pipe.zcard(self._key(user_id))
            _, _, live_after = await pipe.execute()
        except redis.RedisError:
            logger.warning("Presence: failed to unregister %s", user_id, exc_info=True)
            return False
        return live_after == 0

    async def online_among(self, user_ids: list[str]) -> set[str]:
        """Which of these users have a live connection right now."""
        if not user_ids:
            return set()

        cutoff = time.time() - CONNECTION_TTL_SECONDS
        try:
            pipe = self._redis.pipeline()
            for user_id in user_ids:
                pipe.zcount(self._key(user_id), cutoff, "+inf")
            counts = await pipe.execute()
        except redis.RedisError:
            logger.warning("Presence: lookup failed", exc_info=True)
            return set()

        return {user_id for user_id, count in zip(user_ids, counts) if count}


presence = PresenceTracker()
