from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.core.storage import storage
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate


class ProfileUpdateError(Exception):
    """A profile edit the caller must fix (taken username, wrong password…).

    Carries a translator key rather than a message so the route can render it
    in the caller's Accept-Language, the same way registration conflicts do.
    """

    def __init__(self, key: str) -> None:
        super().__init__(key)
        self.key = key


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
    async def update(self, user: User, data: UserUpdate) -> User:
        """Apply a partial profile edit in place.

        Only fields the client actually sent are touched — `exclude_unset`
        is what separates "leave my email alone" from "clear my full name",
        which both arrive as a missing/null value otherwise.

        `username` is not editable here by design — see `UserUpdate`. An
        unknown key in the payload is dropped by Pydantic, so a client that
        sends one gets its other fields applied and the username ignored,
        never a partial-looking success.
        """
        fields = data.model_dump(exclude_unset=True)

        if "email" in fields and fields["email"] != user.email:
            email = fields["email"]
            if not email:
                raise ProfileUpdateError("email_required")
            existing = await self.get_by_email(email)
            if existing is not None and existing.id != user.id:
                raise ProfileUpdateError("email_already_registered")
            user.email = email

        if "full_name" in fields:
            user.full_name = fields["full_name"]

        if fields.get("password"):
            # A valid token is not enough to change the password: it may be a
            # borrowed/leaked one, and a password change locks the real owner out.
            current = fields.get("current_password")
            if not current or not verify_password(current, user.hashed_password):
                raise ProfileUpdateError("current_password_incorrect")
            user.hashed_password = hash_password(fields["password"])

        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)
        return user

    async def set_avatar(self, user: User, data: bytes, ext: str) -> User:
        """Store validated image bytes and point the user at them."""
        previous = user.avatar_url
        url = await storage.save(data, folder="avatars", ext=ext)

        user.avatar_url = url
        self.db.add(user)
        try:
            # Committed here rather than left to get_db: the old file is only
            # safe to delete once the new URL is durable. Rolling back after
            # the delete would leave the row pointing at a file that's gone.
            await self.db.commit()
        except Exception:
            # Don't leave the just-written file behind for a write that failed.
            await storage.delete(url)
            raise

        await storage.delete(previous)
        return user

    async def clear_avatar(self, user: User) -> User:
        previous = user.avatar_url
        user.avatar_url = None
        self.db.add(user)
        await self.db.commit()
        await storage.delete(previous)
        return user
