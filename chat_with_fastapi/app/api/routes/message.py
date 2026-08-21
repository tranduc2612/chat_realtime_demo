import json

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token
from app.core.websocket import manager
from app.api.deps import CurrentUser
from app.models.user import User
from app.schemas.message import MessageResponse, SendMessage
from app.services.message_service import MessageService
from app.services.user_service import UserService

router = APIRouter(prefix="/messages", tags=["messages"])


@router.get("/{conversation_id}", response_model=list[MessageResponse])
async def get_history(
    conversation_id: str,
    current_user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=100),
    before_id: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[MessageResponse]:
    service = MessageService(db)
    try:
        messages = await service.get_history(conversation_id, current_user.id, limit, before_id)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    return messages


@router.post("/send", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    data: SendMessage,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    service = MessageService(db)
    try:
        message = await service.send(sender_id=current_user.id, data=data)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))

    response = MessageResponse.model_validate(message)
    payload = {"event": "new_message", "data": response.model_dump(mode="json")}

    # Notify clients watching this conversation room
    await manager.broadcast(conversation_id=data.conversation_id, payload=payload)

    # Notify ALL members via their user-level channel (covers members not in the room)
    member_ids = await service.get_member_ids(data.conversation_id)
    await manager.notify_users(member_ids, payload)

    return response


async def _broadcast_typing(conversation_id: str, user: User, is_typing: bool) -> None:
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


async def _handle_client_frame(raw: str, conversation_id: str, user: User) -> None:
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

    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)
    if user is None or not user.is_active:
        await websocket.close(code=4001)
        return

    msg_service = MessageService(db)
    member = await msg_service.get_member(conversation_id, user_id)
    if member is None:
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

    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)
    if user is None or not user.is_active:
        await websocket.close(code=4001)
        return

    await manager.connect_user(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_user(user_id, websocket)
