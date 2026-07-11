from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.message import MessageType
from app.models.message_attachment import AttachmentType


class AttachmentCreate(BaseModel):
    type: AttachmentType
    url: str
    thumbnail_url: Optional[str] = None
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration_seconds: Optional[int] = None


class AttachmentResponse(AttachmentCreate):
    id: int
    message_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SendMessage(BaseModel):
    conversation_id: str
    type: MessageType = MessageType.TEXT
    content: Optional[str] = None
    reply_to_message_id: Optional[str] = None
    attachments: list[AttachmentCreate] = []


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    sender_id: Optional[str]
    type: MessageType
    content: Optional[str]
    reply_to_message_id: Optional[str]
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentResponse] = []

    model_config = {"from_attributes": True}
