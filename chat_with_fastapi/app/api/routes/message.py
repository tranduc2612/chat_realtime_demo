
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import CurrentUser, Language, get_current_active_user, get_language
from app.models.user import User
from app.schemas.user import UserCreate, UserListResponse, UserResponse, UserUpdate
from app.services.user_service import UserService
from app.utils.translator import translate


router = APIRouter(prefix="/messages", tags=["messages"])

@router.post("/send-message", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    message: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    # raise HTTPException(status_code=400, detail=translate(lang, "email_already_registered"))
    # Implementation for sending a message would go here
    pass
