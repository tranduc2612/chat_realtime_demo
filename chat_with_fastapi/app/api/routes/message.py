from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.events import events
from app.api.deps import CurrentUser
from app.models.user import User
from app.schemas.message import MarkRead, MessageResponse, ReadReceipt, SendMessage
from app.services.message_service import MessageService

router = APIRouter(prefix="/messages", tags=["messages"])


def _to_receipt(user: User, last_read_message_id: str | None) -> ReadReceipt:
    return ReadReceipt(
        user_id=user.id,
        username=user.username,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        last_read_message_id=last_read_message_id,
    )


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


@router.get("/{conversation_id}/reads", response_model=list[ReadReceipt])
async def get_read_receipts(
    conversation_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[ReadReceipt]:
    service = MessageService(db)
    try:
        receipts = await service.get_read_receipts(conversation_id, current_user.id)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    return [_to_receipt(user, last_read_id) for user, last_read_id in receipts]


@router.post("/{conversation_id}/read", response_model=ReadReceipt)
async def mark_read(
    conversation_id: str,
    data: MarkRead,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ReadReceipt:
    service = MessageService(db)
    try:
        member = await service.mark_read(conversation_id, current_user.id, data.message_id)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    receipt = _to_receipt(
        current_user,
        member.last_read_message_id if member else data.message_id,
    )

    # member is None when the watermark didn't move — everyone already knows
    if member is not None:
        payload = {
            "event": "message_read",
            "data": {"conversation_id": conversation_id, **receipt.model_dump()},
        }
        # Room-only: anyone opening this conversation later refetches GET /reads
        await events.broadcast(conversation_id=conversation_id, payload=payload)

    return receipt


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
    await events.broadcast(conversation_id=data.conversation_id, payload=payload)

    # Notify ALL members via their user-level channel (covers members not in the room)
    member_ids = await service.get_member_ids(data.conversation_id)
    await events.notify_users(member_ids, payload)

    return response
