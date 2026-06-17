from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.message import MessageType


class MessageBase(BaseModel):
    sender_id: str
    conversation_id: int
    content: str | None = NotImplemented


class SendMessage(MessageBase):
    type: MessageType


