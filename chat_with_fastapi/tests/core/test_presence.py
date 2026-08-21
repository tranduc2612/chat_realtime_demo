"""Presence counting: online means "at least one live connection".

The counting is what matters — a user with two tabs open must stay online when
one closes, and connections left behind by a crashed replica must stop counting
on their own.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.presence import CONNECTION_TTL_SECONDS, PresenceTracker


@pytest.fixture
def tracker():
    with patch("app.core.presence.redis.from_url"):
        return PresenceTracker()


def stub_pipeline(tracker: PresenceTracker, results: list) -> MagicMock:
    pipe = MagicMock()
    pipe.execute = AsyncMock(return_value=results)
    tracker._redis.pipeline = MagicMock(return_value=pipe)
    return pipe


class TestConnected:
    async def test_first_connection_reports_newly_online(self, tracker):
        stub_pipeline(tracker, [0, 0, 1, True])  # zremrangebyscore, zcard=0, zadd, expire

        assert await tracker.connected("user-a", "conn-1") is True

    async def test_second_tab_does_not_report_newly_online(self, tracker):
        stub_pipeline(tracker, [0, 1, 1, True])  # zcard=1: already had a connection

        assert await tracker.connected("user-a", "conn-2") is False

    async def test_redis_failure_does_not_raise(self, tracker):
        import redis.asyncio as redis

        pipe = MagicMock()
        pipe.execute = AsyncMock(side_effect=redis.RedisError("down"))
        tracker._redis.pipeline = MagicMock(return_value=pipe)

        assert await tracker.connected("user-a", "conn-1") is False


class TestDisconnected:
    async def test_last_connection_reports_offline(self, tracker):
        stub_pipeline(tracker, [1, 0, 0])  # zrem, zremrangebyscore, zcard=0

        assert await tracker.disconnected("user-a", "conn-1") is True

    async def test_closing_one_of_two_tabs_stays_online(self, tracker):
        stub_pipeline(tracker, [1, 0, 1])  # zcard=1: another tab is still open

        assert await tracker.disconnected("user-a", "conn-1") is False


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
