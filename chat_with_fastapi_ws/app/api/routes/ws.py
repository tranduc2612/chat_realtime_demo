"""The two WebSocket endpoints — the entire public surface of this service.

Paths match what the HTTP API used to serve (`/api/v1/messages/ws/...`), so
clients only change host and port, not their URLs.
"""
import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal, get_db
from app.core.presence import HEARTBEAT_INTERVAL_SECONDS, presence
from app.core.security import decode_access_token
from app.core.websocket import manager
from app.db import queries
from app.db.queries import SocketUser

router = APIRouter(prefix="/messages", tags=["websocket"])


async def _heartbeat(user_id: str, connection_id: str) -> None:
    """Keep this connection's presence entry fresh for as long as it's open."""
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
        await presence.heartbeat(user_id, connection_id)


async def _publish_presence(user_id: str, is_online: bool) -> None:
    """Persist last_seen_at and tell this user's contacts they came on/offline.

    Uses its own session rather than the socket's: that one was opened when the
    connection was established, which may have been hours ago.
    """
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await queries.set_presence(db, user_id, is_online, now)
        contact_ids = await queries.get_contact_ids(db, user_id)

    await manager.notify_users(
        contact_ids,
        {
            "event": "presence",
            "data": {
                "user_id": user_id,
                "is_online": is_online,
                "last_seen_at": now.isoformat(),
            },
        },
    )


async def _broadcast_typing(conversation_id: str, user: SocketUser, is_typing: bool) -> None:
    """Tell everyone else in the room whether `user` is currently typing."""
    await manager.broadcast(
        conversation_id=conversation_id,
        payload={
            "event": "typing",
            "data": {
                "conversation_id": conversation_id,
                "user_id": user.id,
                "username": user.username,
                "full_name": user.full_name,
                "avatar_url": user.avatar_url,
                "is_typing": is_typing,
            },
        },
        exclude_user_id=user.id,
    )


async def _handle_client_frame(raw: str, conversation_id: str, user: SocketUser) -> None:
    """Handle a frame sent *up* the room socket.

    Only `typing` is understood; anything else (including non-JSON keepalive
    pings) is ignored rather than closing the socket.
    """
    try:
        frame = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return

    if not isinstance(frame, dict) or frame.get("event") != "typing":
        return

    data = frame.get("data")
    is_typing = bool(data.get("is_typing")) if isinstance(data, dict) else False
    await _broadcast_typing(conversation_id, user, is_typing)


@router.websocket("/ws/{conversation_id}")
async def websocket_conversation(
    conversation_id: str,
    websocket: WebSocket,
    token: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """ws://.../api/v1/messages/ws/{conversation_id}?token=<jwt>"""
    user_id = decode_access_token(token)
    if user_id is None:
        await websocket.close(code=4001)
        return

    user = await queries.get_user(db, user_id)
    if user is None or not user.is_active:
        await websocket.close(code=4001)
        return

    if not await queries.is_conversation_member(db, conversation_id, user_id):
        await websocket.close(code=4003)
        return

    await manager.connect(conversation_id, user_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            await _handle_client_frame(raw, conversation_id, user)
    except WebSocketDisconnect:
        manager.disconnect(conversation_id, user_id, websocket)
        # A client that closes mid-typing never gets to send is_typing=false,
        # so retract it here — otherwise the indicator sticks on other screens.
        await _broadcast_typing(conversation_id, user, is_typing=False)


@router.websocket("/ws/user/me")
async def websocket_user(
    websocket: WebSocket,
    token: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """ws://.../api/v1/messages/ws/user/me?token=<jwt>

    Receives new_message events for ALL conversations the user belongs to.
    """
    user_id = decode_access_token(token)
    if user_id is None:
        await websocket.close(code=4001)
        return

    user = await queries.get_user(db, user_id)
    if user is None or not user.is_active:
        await websocket.close(code=4001)
        return

    await manager.connect_user(user_id, websocket)

    # This socket lives for the whole session (one per tab), which makes it the
    # natural signal for "is this user online". Counting connections in Redis is
    # what lets a second tab close without reporting the user offline.
    connection_id = uuid4().hex
    if await presence.connected(user_id, connection_id):
        await _publish_presence(user_id, is_online=True)
    heartbeat = asyncio.create_task(_heartbeat(user_id, connection_id))

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_user(user_id, websocket)
    finally:
        heartbeat.cancel()
        if await presence.disconnected(user_id, connection_id):
            await _publish_presence(user_id, is_online=False)
