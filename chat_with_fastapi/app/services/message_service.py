from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.conversation import Conversation
from app.models.conversation_member import ConversationMember
from app.models.message import Message
from app.models.message_attachment import MessageAttachment
from app.schemas.message import SendMessage


class MessageService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_member(self, conversation_id: str, user_id: str) -> ConversationMember | None:
        result = await self.db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
                ConversationMember.left_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_member_ids(self, conversation_id: str) -> list[str]:
        result = await self.db.execute(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.left_at.is_(None),
            )
        )
        return list(result.scalars().all())

    async def get_history(
        self,
        conversation_id: str,
        user_id: str,
        limit: int = 50,
        before_id: str | None = None,
    ) -> list[Message]:
        member = await self.get_member(conversation_id, user_id)
        if member is None:
            raise PermissionError("User is not a member of this conversation")

        query = (
            select(Message)
            .where(
                Message.conversation_id == conversation_id,
                Message.is_deleted == False,
            )
            .options(selectinload(Message.attachments))
            .order_by(Message.created_at.desc())
            .limit(limit)
        )

        if before_id:
            # cursor-based pagination: fetch messages older than before_id
            cursor_result = await self.db.execute(
                select(Message.created_at).where(Message.id == before_id)
            )
            cursor_ts = cursor_result.scalar_one_or_none()
            if cursor_ts:
                query = query.where(Message.created_at < cursor_ts)

        result = await self.db.execute(query)
        # Return in ascending order for display
        return list(reversed(result.scalars().all()))

    async def send(self, sender_id: str, data: SendMessage) -> Message:
        member = await self.get_member(data.conversation_id, sender_id)
        if member is None:
            raise PermissionError("User is not a member of this conversation")

        message = Message(
            conversation_id=data.conversation_id,
            sender_id=sender_id,
            type=data.type,
            content=data.content,
            reply_to_message_id=data.reply_to_message_id,
        )
        self.db.add(message)
        await self.db.flush()  # get message.id before attachments

        for att in data.attachments:
            self.db.add(
                MessageAttachment(
                    message_id=message.id,
                    type=att.type,
                    url=att.url,
                    thumbnail_url=att.thumbnail_url,
                    file_name=att.file_name,
                    file_size=att.file_size,
                    mime_type=att.mime_type,
                    width=att.width,
                    height=att.height,
                    duration_seconds=att.duration_seconds,
                )
            )

        # bump conversation's updated_at so it floats to top of lists
        conv_result = await self.db.execute(
            select(Conversation).where(Conversation.id == data.conversation_id)
        )
        conv = conv_result.scalar_one_or_none()
        if conv:
            conv.updated_at = datetime.now(timezone.utc)
            self.db.add(conv)

        await self.db.commit()

        # reload with attachments eager-loaded for serialization
        result = await self.db.execute(
            select(Message)
            .where(Message.id == message.id)
            .options(selectinload(Message.attachments))
        )
        return result.scalar_one()
