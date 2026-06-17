from datetime import datetime

from pydantic import BaseModel

from app.models.conversation import ConversationType


class ConversationBase(BaseModel):
    type: ConversationType
    avatar_url: str | None = NotImplemented
    name: str

class ConversationCreate(ConversationBase):
    user_ids: list[str]
    created_by_id: str

class ConversationResponse(ConversationBase):
    id: str

    model_config = {"from_attributes": True}