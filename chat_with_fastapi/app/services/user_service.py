from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate


class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: str) -> User | None:
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()
    
    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()
    
    async def get_by_username(self, username: str) -> User | None:
        result = await self.db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()
    
    async def disable_account(self, user: User) -> None:
        user.is_active = 0
        self.db.add(user)
        await self.db.commit()
    
    async def create(self, data: UserCreate) -> User:
        user = User(
            email=data.email,
            username=data.username,
            full_name=data.full_name,
            hashed_password=hash_password(data.password),
            avatar_url=data.avatar_url,
        )
        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)
        return user
    
    async def search(self, q: str, exclude_id: str, limit: int = 10) -> list[User]:
        pattern = f"%{q}%"
        result = await self.db.execute(
            select(User)
            .where(
                User.id != exclude_id,
                User.is_active == True,
                or_(
                    User.username.ilike(pattern),
                    User.full_name.ilike(pattern),
                ),
            )
            .limit(limit)
        )
        return list(result.scalars().all())

    async def authenticate(self, username: str, password: str) -> User | None:
        user = await self.get_by_username(username)
        if not user:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        return user