from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.conversation import ConversationType


class ConversationMemberProfile(BaseModel):
    id: str
    username: str
    full_name: Optional[str]
    avatar_url: Optional[str]
    is_online: bool

    model_config = {"from_attributes": True}


class ConversationCreate(BaseModel):
    type: ConversationType
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    user_ids: list[str]
    created_by_id: str


class AddMembersPayload(BaseModel):
    user_ids: list[str]


class ConversationResponse(BaseModel):
    id: str
    type: ConversationType
    name: Optional[str]
    avatar_url: Optional[str]
    created_by_id: Optional[str]
    created_at: datetime
    updated_at: datetime
    members: list[ConversationMemberProfile] = []

    model_config = {"from_attributes": True}
