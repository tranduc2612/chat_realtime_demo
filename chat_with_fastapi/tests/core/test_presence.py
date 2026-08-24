"""Reading presence. Writing it lives in chat_with_fastapi_ws.

What matters here is the score cutoff: connections left behind by a ws replica
that died without cleaning up must stop counting on their own.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.presence import CONNECTION_TTL_SECONDS, PresenceReader


@pytest.fixture
def tracker():
    with patch("app.core.presence.redis.from_url"):
        return PresenceReader()


def stub_pipeline(tracker: PresenceReader, results: list) -> MagicMock:
    pipe = MagicMock()
    pipe.execute = AsyncMock(return_value=results)
    tracker._redis.pipeline = MagicMock(return_value=pipe)
    return pipe


class TestOnlineAmong:
    async def test_returns_only_users_with_a_live_connection(self, tracker):
        stub_pipeline(tracker, [1, 0, 2])

        online = await tracker.online_among(["user-a", "user-b", "user-c"])

        assert online == {"user-a", "user-c"}

    async def test_empty_input_skips_redis_entirely(self, tracker):
        tracker._redis.pipeline = MagicMock()

        assert await tracker.online_among([]) == set()
        tracker._redis.pipeline.assert_not_called()

    async def test_counts_only_heartbeats_newer_than_the_ttl(self, tracker):
        pipe = stub_pipeline(tracker, [1])

        await tracker.online_among(["user-a"])

        _key, cutoff, upper = pipe.zcount.call_args.args
        assert upper == "+inf"
        # Anything older than the TTL is ignored, which is how entries from a
        # replica that died without cleaning up stop counting
        import time

        assert time.time() - CONNECTION_TTL_SECONDS - 1 <= cutoff <= time.time() - CONNECTION_TTL_SECONDS + 1

    async def test_redis_failure_reports_nobody_online(self, tracker):
        import redis.asyncio as redis

        pipe = MagicMock()
        pipe.execute = AsyncMock(side_effect=redis.RedisError("down"))
        tracker._redis.pipeline = MagicMock(return_value=pipe)

        assert await tracker.online_among(["user-a"]) == set()
