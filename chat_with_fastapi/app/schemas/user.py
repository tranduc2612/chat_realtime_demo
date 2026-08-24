from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserBase(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=100)
    full_name: str | None = None
    avatar_url: str | None = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)


class UserUpdate(BaseModel):
    """Profile edit. Every field is optional — only what's sent is changed.

    Two fields are deliberately absent, and both would be a mistake to add:

    - `username` is the login identifier. Changing it silently invalidates
      whatever the user (or their password manager) types at the login form,
      and every "@name" anyone has seen. It is set once at registration.
    - `avatar_url` is set by uploading to `POST /users/me/avatar`, which
      validates the bytes. Accepting a raw URL here would let a client point
      their avatar at anything, including a `javascript:` URL rendered
      straight into an <img src>.
    """

    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8)
    # Required by the service whenever `password` is set — changing a password
    # must prove you own the session's account, not just hold its token.
    current_password: str | None = None

    @field_validator("full_name")
    @classmethod
    def blank_full_name_is_null(cls, v: str | None) -> str | None:
        # "  " from an emptied input means "clear my name", not a name of spaces
        if v is None:
            return None
        stripped = v.strip()
        return stripped or None


class UserResponse(UserBase):
    id: str
    is_active: bool
    is_online: bool
    last_seen_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    total: int
    items: list[UserResponse]
