
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import CurrentUser, Language, get_current_active_user, get_language
from app.models.user import User
from app.schemas.conversation import ConversationCreate, ConversationResponse
from app.schemas.user import UserCreate, UserListResponse, UserResponse, UserUpdate

from app.services.conversation_service import ConversationService
from app.utils.translator import translate


router = APIRouter(prefix="/conversations", tags=["conversations"])

@router.post("/create-conversation", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    data: ConversationCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    service = ConversationService(db)
    return await service.create(data)
    # raise HTTPException(status_code=400, detail=translate(lang, "email_already_registered"))
    # Implementation for creating a conversation would go here
    pass
