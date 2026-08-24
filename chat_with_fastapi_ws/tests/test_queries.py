"""The four statements that make up this service's dependency on the schema.

Mocks can't prove the SQL matches the real tables — the e2e suite does that
against a live database. What they pin down is the mapping and the parameters,
so a typo'd bind name or a dropped column shows up here first.
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import queries


@pytest.fixture
def db() -> MagicMock:
    return MagicMock(spec=AsyncSession)


def result_with(first=None, rows=()):
    result = MagicMock()
    result.first.return_value = first
    result.__iter__ = lambda self: iter(rows)
    return result


def bind_params(db: MagicMock) -> dict:
    return db.execute.await_args.args[1]


class TestGetUser:
    async def test_maps_a_row_onto_socket_user(self, db):
        row = MagicMock(
            id="user-a", username="alice", full_name="Alice", avatar_url="http://x/a.png", is_active=1
        )
        db.execute = AsyncMock(return_value=result_with(first=row))

        user = await queries.get_user(db, "user-a")

        assert (user.id, user.username, user.full_name, user.avatar_url) == (
            "user-a",
            "alice",
            "Alice",
            "http://x/a.png",
        )
        # MySQL hands back 1/0 for BOOLEAN, and the socket auth check is `not is_active`
        assert user.is_active is True

    async def test_a_disabled_account_is_reported_as_inactive(self, db):
        db.execute = AsyncMock(
            return_value=result_with(
                first=MagicMock(id="u", username="u", full_name=None, avatar_url=None, is_active=0)
            )
        )

        assert (await queries.get_user(db, "u")).is_active is False

    async def test_missing_user_is_none(self, db):
        db.execute = AsyncMock(return_value=result_with(first=None))

        assert await queries.get_user(db, "nobody") is None


class TestIsConversationMember:
    async def test_true_when_a_row_matches(self, db):
        db.execute = AsyncMock(return_value=result_with(first=(1,)))

        assert await queries.is_conversation_member(db, "conv-1", "user-a") is True
        assert bind_params(db) == {"conversation_id": "conv-1", "user_id": "user-a"}

    async def test_false_for_a_non_member(self, db):
        db.execute = AsyncMock(return_value=result_with(first=None))

        assert await queries.is_conversation_member(db, "conv-1", "stranger") is False


class TestGetContactIds:
    async def test_collects_the_user_ids(self, db):
        db.execute = AsyncMock(
            return_value=result_with(rows=[MagicMock(user_id="user-b"), MagicMock(user_id="user-c")])
        )

        assert await queries.get_contact_ids(db, "user-a") == ["user-b", "user-c"]

    async def test_empty_for_someone_with_no_conversations(self, db):
        db.execute = AsyncMock(return_value=result_with(rows=[]))

        assert await queries.get_contact_ids(db, "user-a") == []


class TestSetPresence:
    async def test_writes_both_columns_and_commits(self, db):
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)

        await queries.set_presence(db, "user-a", True, now)

        assert bind_params(db) == {"is_online": True, "seen_at": now, "user_id": "user-a"}
        db.commit.assert_awaited_once()
