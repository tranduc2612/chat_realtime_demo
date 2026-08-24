"""Every database statement this service issues, in one file.

Deliberately explicit SQL rather than a copy of the API project's ORM models:
a second copy of six model files would be six files to keep in sync, while the
four statements below are the entire surface this service depends on. If the
API project renames one of these columns, the breakage is here and obvious.

Read-mostly — the only write is the presence pair on `users`. Schema ownership
and migrations stay with the HTTP API project.
"""
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class SocketUser:
    """The bits of a user this service needs: auth, plus typing/presence payloads."""

    id: str
    username: str
    full_name: str | None
    avatar_url: str | None
    is_active: bool


async def get_user(db: AsyncSession, user_id: str) -> SocketUser | None:
    result = await db.execute(
        text(
            "SELECT id, username, full_name, avatar_url, is_active "
            "FROM users WHERE id = :user_id"
        ),
        {"user_id": user_id},
    )
    row = result.first()
    if row is None:
        return None
    return SocketUser(
        id=row.id,
        username=row.username,
        full_name=row.full_name,
        avatar_url=row.avatar_url,
        is_active=bool(row.is_active),
    )


async def is_conversation_member(db: AsyncSession, conversation_id: str, user_id: str) -> bool:
    """left_at IS NULL — removed members must not be able to open a socket."""
    result = await db.execute(
        text(
            "SELECT 1 FROM conversation_members "
            "WHERE conversation_id = :conversation_id AND user_id = :user_id "
            "AND left_at IS NULL LIMIT 1"
        ),
        {"conversation_id": conversation_id, "user_id": user_id},
    )
    return result.first() is not None


async def get_contact_ids(db: AsyncSession, user_id: str) -> list[str]:
    """Everyone sharing a conversation with this user — who hears their presence.

    Broadcasting to every account instead would leak who is online to strangers
    and cost a Redis publish per user on the whole instance.
    """
    result = await db.execute(
        text(
            "SELECT DISTINCT other.user_id FROM conversation_members AS other "
            "JOIN conversation_members AS mine "
            "  ON mine.conversation_id = other.conversation_id "
            "WHERE mine.user_id = :user_id AND mine.left_at IS NULL "
            "  AND other.user_id <> :user_id AND other.left_at IS NULL"
        ),
        {"user_id": user_id},
    )
    return [row.user_id for row in result]


async def set_presence(db: AsyncSession, user_id: str, is_online: bool, seen_at: datetime) -> None:
    """Last known presence, for REST responses the API project serves.

    Redis stays the live truth (see app/core/presence.py); this column only
    records the last transition.
    """
    await db.execute(
        text(
            "UPDATE users SET is_online = :is_online, last_seen_at = :seen_at "
            "WHERE id = :user_id"
        ),
        {"is_online": is_online, "seen_at": seen_at, "user_id": user_id},
    )
    await db.commit()
