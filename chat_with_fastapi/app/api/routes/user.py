
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.presence import presence
from app.api.deps import CurrentUser, Language, get_current_active_user, get_language
from app.models.user import User
from app.schemas.user import UserCreate, UserListResponse, UserResponse, UserUpdate
from app.services.user_service import ProfileUpdateError, UserService
from app.utils.images import ImageValidationError, read_image_upload
from app.utils.translator import translate


router = APIRouter(prefix="/users", tags=["users"])

@router.get("/search", response_model=list[UserResponse])
async def search_users(
    current_user: CurrentUser,
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
) -> list[UserResponse]:
    service = UserService(db)
    users = await service.search(q, exclude_id=current_user.id)

    # Overlay live presence, same as the conversation list — User.is_online is
    # only the last known value
    online = await presence.online_among([u.id for u in users])
    return [
        UserResponse.model_validate(u).model_copy(update={"is_online": u.id in online})
        for u in users
    ]


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_active_user)) -> User:
    return current_user

@router.put("/me", response_model=UserResponse)
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    lang: str = Depends(get_language),
) -> User:
    service = UserService(db)
    try:
        return await service.update(current_user, data)
    except ProfileUpdateError as exc:
        raise HTTPException(status_code=400, detail=translate(lang, exc.key))


@router.post("/me/avatar", response_model=UserResponse)
async def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    lang: str = Depends(get_language),
) -> User:
    """Replace the caller's avatar with an uploaded image.

    Separate from `PUT /me` because it's multipart and because the stored
    value has to come from bytes we validated ourselves — see
    `UserUpdate`'s docstring for why `avatar_url` isn't settable directly.
    """
    try:
        data, ext = await read_image_upload(file, settings.MAX_AVATAR_BYTES)
    except ImageValidationError as exc:
        raise HTTPException(status_code=400, detail=translate(lang, exc.key))

    service = UserService(db)
    return await service.set_avatar(current_user, data, ext)


@router.delete("/me/avatar", response_model=UserResponse)
async def delete_my_avatar(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    service = UserService(db)
    return await service.clear_avatar(current_user)


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    lang: str = Depends(get_language),
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
