"""Typing events sent *up* the conversation WebSocket.

Covers the frame parser in the route plus the sender-exclusion the room
delivery relies on, both of which sit outside the service layer.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.routes.message import _handle_client_frame
from app.core.websocket import ConnectionManager


@pytest.fixture
def user() -> MagicMock:
    user = MagicMock()
    user.id = "user-a"
    user.username = "alice"
    user.full_name = "Alice"
    user.avatar_url = "https://example.com/alice.png"
    return user


async def handle(raw: str, user: MagicMock) -> MagicMock:
    with patch("app.api.routes.message.manager.broadcast", new_callable=AsyncMock) as broadcast:
        await _handle_client_frame(raw, "conv-1", user)
    return broadcast


class TestHandleClientFrame:
    async def test_typing_start_broadcasts_excluding_sender(self, user):
        broadcast = await handle('{"event": "typing", "data": {"is_typing": true}}', user)

        broadcast.assert_awaited_once_with(
            conversation_id="conv-1",
            payload={
                "event": "typing",
                "data": {
                    "conversation_id": "conv-1",
                    "user_id": "user-a",
                    "username": "alice",
                    "full_name": "Alice",
                    "avatar_url": "https://example.com/alice.png",
                    "is_typing": True,
                },
            },
            exclude_user_id="user-a",
        )

    async def test_typing_stop_broadcasts_is_typing_false(self, user):
        broadcast = await handle('{"event": "typing", "data": {"is_typing": false}}', user)

        assert broadcast.await_args.kwargs["payload"]["data"]["is_typing"] is False

    async def test_missing_data_is_treated_as_stop(self, user):
        broadcast = await handle('{"event": "typing"}', user)

        assert broadcast.await_args.kwargs["payload"]["data"]["is_typing"] is False

    @pytest.mark.parametrize(
        "raw",
        [
            "not json",
            '{"event": "something_else"}',
            '["typing"]',
            '"typing"',
        ],
    )
    async def test_junk_frames_are_ignored_without_broadcasting(self, raw, user):
        broadcast = await handle(raw, user)

        broadcast.assert_not_awaited()


class TestRoomDeliveryExclusion:
    async def test_excluded_user_does_not_receive_the_event(self):
        with patch("app.core.websocket.redis.from_url"):
            manager = ConnectionManager()

        sender_ws, other_ws = AsyncMock(), AsyncMock()
        manager._rooms["conv-1"] = [("user-a", sender_ws), ("user-b", other_ws)]

        await manager._deliver_room("conv-1", {"event": "typing"}, exclude_user_id="user-a")

        sender_ws.send_json.assert_not_awaited()
        other_ws.send_json.assert_awaited_once_with({"event": "typing"})

    async def test_no_exclusion_reaches_everyone(self):
        with patch("app.core.websocket.redis.from_url"):
            manager = ConnectionManager()

        first, second = AsyncMock(), AsyncMock()
        manager._rooms["conv-1"] = [("user-a", first), ("user-b", second)]

        await manager._deliver_room("conv-1", {"event": "new_message"})

        first.send_json.assert_awaited_once()
        second.send_json.assert_awaited_once()


class TestDeadSocketPruning:
    """A send that fails prunes the socket — even if disconnect() beat us to it.

    Losing that race used to raise ValueError out of the Redis listener task,
    which nothing restarts, silently killing realtime for the whole process.
    """

    @pytest.fixture
    def manager(self) -> ConnectionManager:
        with patch("app.core.websocket.redis.from_url"):
            return ConnectionManager()

    async def test_room_prunes_a_socket_that_fails_to_send(self, manager):
        broken, healthy = AsyncMock(), AsyncMock()
        broken.send_json.side_effect = RuntimeError("socket closed")
        manager._rooms["conv-1"] = [("user-a", broken), ("user-b", healthy)]

        await manager._deliver_room("conv-1", {"event": "typing"})

        assert manager._rooms["conv-1"] == [("user-b", healthy)]

    async def test_room_survives_a_concurrent_disconnect(self, manager):
        broken, healthy = AsyncMock(), AsyncMock()
        healthy_entry = ("user-b", healthy)

        async def disconnect_mid_send(_payload):
            # What disconnect() does: rebuild the list without this socket
            manager._rooms["conv-1"] = [healthy_entry]
            raise RuntimeError("socket closed")

        broken.send_json.side_effect = disconnect_mid_send
        manager._rooms["conv-1"] = [("user-a", broken), healthy_entry]

        await manager._deliver_room("conv-1", {"event": "typing"})

        assert manager._rooms["conv-1"] == [healthy_entry]

    async def test_user_channel_survives_a_concurrent_disconnect(self, manager):
        broken, healthy = AsyncMock(), AsyncMock()

        async def disconnect_mid_send(_payload):
            manager._users["user-a"] = [healthy]
            raise RuntimeError("socket closed")

        broken.send_json.side_effect = disconnect_mid_send
        manager._users["user-a"] = [broken, healthy]

        await manager._deliver_user("user-a", {"event": "new_message"})

        assert manager._users["user-a"] == [healthy]
