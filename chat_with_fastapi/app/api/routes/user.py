
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import CurrentUser, Language, get_current_active_user, get_language
from app.models.user import User
from app.schemas.user import UserCreate, UserListResponse, UserResponse, UserUpdate
from app.services.user_service import UserService
from app.utils.translator import translate


router = APIRouter(prefix="/users", tags=["users"])

@router.get("/search", response_model=list[UserResponse])
async def search_users(
    current_user: CurrentUser,
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
) -> list[UserResponse]:
    service = UserService(db)
    return await service.search(q, exclude_id=current_user.id)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_active_user)) -> User:
    return current_user

@router.put("/me", response_model=UserResponse)
async def update_me(
    data: UserUpdate,
    current_user = CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> User:
    service = UserService(db)
    return await service.update(current_user, data)

@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    lang = Language,
) -> User:
    service = UserService(db)
    if await service.get_by_email(data.email):
        raise HTTPException(status_code=400, detail=translate(lang, "email_already_registered"))
    if await service.get_by_username(data.username):
        raise HTTPException(status_code=400, detail=translate(lang, "username_already_taken"))
    return await service.create(data)

@router.delete("/disable/{item_id}")
async def disable_user(
    item_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    service = UserService(db)
    user = await service.get_by_id(item_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    await service.disable_account(user)
    return {"detail": True}