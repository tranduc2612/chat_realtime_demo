from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.presence import presence
from app.api.deps import CurrentUser
from app.schemas.conversation import AddMembersPayload, ConversationCreate, ConversationMemberProfile, ConversationResponse
from app.services.conversation_service import ConversationService

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def _online_ids(convs) -> set[str]:
    """One presence lookup covering every member of every conversation."""
    member_ids = {
        m.user.id for conv in convs for m in conv.members if m.user is not None and m.left_at is None
    }
    return await presence.online_among(list(member_ids))


def _build_response(conv, current_user_id: str, online_ids: set[str]) -> ConversationResponse:
    members = [
        ConversationMemberProfile(
            id=m.user.id,
            username=m.user.username,
            full_name=m.user.full_name,
            avatar_url=m.user.avatar_url,
            # Redis is the live truth; User.is_online is only the last known
            # value, which goes stale if a replica dies without cleaning up
            is_online=m.user.id in online_ids,
        )
        for m in conv.members
        if m.user is not None and m.left_at is None
    ]
    return ConversationResponse(
        id=conv.id,
        type=conv.type,
        name=conv.name,
        avatar_url=conv.avatar_url,
        created_by_id=conv.created_by_id,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        members=members,
    )


@router.get("", response_model=list[ConversationResponse])
async def list_conversations(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[ConversationResponse]:
    service = ConversationService(db)
    convs = await service.get_list_for_user(current_user.id)
    online = await _online_ids(convs)
    return [_build_response(c, current_user.id, online) for c in convs]


@router.post("", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    data: ConversationCreate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    service = ConversationService(db)

    if data.type == "direct" and len(data.user_ids) == 1:
        existing = await service.find_direct(current_user.id, data.user_ids[0])
        if existing:
            conv = await service.get_with_members(existing.id)
            return _build_response(conv, current_user.id, await _online_ids([conv]))

    data.created_by_id = current_user.id
    try:
        created = await service.create(data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    conv = await service.get_with_members(created.id)
    return _build_response(conv, current_user.id, await _online_ids([conv]))


@router.post("/{conversation_id}/members", response_model=ConversationResponse)
async def add_members(
    conversation_id: str,
    data: AddMembersPayload,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    service = ConversationService(db)
    try:
        conv = await service.add_members(conversation_id, data.user_ids, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return _build_response(conv, current_user.id, await _online_ids([conv]))
