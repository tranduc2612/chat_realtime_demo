"""Publishing to the WebSocket service.

The envelope shape asserted here is a contract with chat_with_fastapi_ws: its
listener reads `scope`, `target`, `payload` and `exclude` by name. Changing one
side alone silently breaks realtime, so these tests pin the wire format.
"""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import redis.asyncio as redis

from app.core.events import CHANNEL, EventPublisher


@pytest.fixture
def publisher() -> EventPublisher:
    with patch("app.core.events.redis.from_url"):
        pub = EventPublisher()
    pub._redis.publish = AsyncMock()
    return pub


def published(publisher: EventPublisher) -> dict:
    channel, raw = publisher._redis.publish.await_args.args
    assert channel == CHANNEL
    return json.loads(raw)


class TestBroadcast:
    async def test_room_envelope(self, publisher):
        await publisher.broadcast("conv-1", {"event": "new_message"})

        assert published(publisher) == {
            "scope": "room",
            "target": "conv-1",
            "payload": {"event": "new_message"},
            "exclude": None,
        }

    async def test_exclude_is_carried_for_typing(self, publisher):
        await publisher.broadcast("conv-1", {"event": "typing"}, exclude_user_id="user-a")

        assert published(publisher)["exclude"] == "user-a"


class TestNotifyUsers:
    async def test_user_envelope(self, publisher):
        await publisher.notify_user("user-a", {"event": "presence"})

        assert published(publisher) == {
            "scope": "user",
            "target": "user-a",
            "payload": {"event": "presence"},
        }

    async def test_one_publish_per_user(self, publisher):
        await publisher.notify_users(["user-a", "user-b", "user-c"], {"event": "new_message"})

        assert publisher._redis.publish.await_count == 3


async def test_a_redis_failure_does_not_break_the_request(publisher):
    """The message is already committed — realtime delivery is best-effort."""
    publisher._redis.publish = AsyncMock(side_effect=redis.RedisError("down"))

    await publisher.broadcast("conv-1", {"event": "new_message"})
    await publisher.notify_user("user-a", {"event": "new_message"})
