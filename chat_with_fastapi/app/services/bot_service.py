from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bot_conversation import BotConversation, BotMessage, BotMessageRole

# Longest auto-derived thread title before it gets an ellipsis.
TITLE_MAX_LENGTH = 60


def derive_title(question: str) -> str:
    """Name a thread after its opening question.

    Cheaper and more predictable than spending an extra LLM call on titling,
    and the first question is almost always what the user is looking for when
    scanning the sidebar later.
    """
    title = " ".join(question.split())
    if len(title) <= TITLE_MAX_LENGTH:
        return title or "New chat"
    return title[:TITLE_MAX_LENGTH - 1].rstrip() + "…"


class BotService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_conversations(self, user_id: str) -> list[BotConversation]:
        result = await self.db.execute(
            select(BotConversation)
            .where(BotConversation.user_id == user_id)
            .order_by(BotConversation.updated_at.desc())
        )
        return list(result.scalars().all())

    async def get_conversation(self, conversation_id: str, user_id: str) -> BotConversation | None:
        """Scoped by user_id: a bot thread is private to the person who owns it."""
        result = await self.db.execute(
            select(BotConversation).where(
                BotConversation.id == conversation_id,
                BotConversation.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_conversation(self, user_id: str, title: str | None = None) -> BotConversation:
        conversation = BotConversation(user_id=user_id, title=title)
        self.db.add(conversation)
        await self.db.commit()
        await self.db.refresh(conversation)
        return conversation

    async def delete_conversation(self, conversation_id: str, user_id: str) -> bool:
        conversation = await self.get_conversation(conversation_id, user_id)
        if conversation is None:
            return False
        await self.db.delete(conversation)
        await self.db.commit()
        return True

    async def get_messages(self, conversation_id: str) -> list[BotMessage]:
        result = await self.db.execute(
            select(BotMessage)
            .where(BotMessage.bot_conversation_id == conversation_id)
            .order_by(BotMessage.created_at.asc(), BotMessage.id.asc())
        )
        return list(result.scalars().all())

    async def history_for_prompt(self, conversation_id: str, limit: int) -> list[dict]:
        """Recent turns as OpenAI-shaped dicts, oldest first.

        Fetched newest-first then reversed so the cap keeps the *latest* turns
        — an ascending query with a limit would replay the oldest ones instead.
        """
        result = await self.db.execute(
            select(BotMessage)
            .where(BotMessage.bot_conversation_id == conversation_id)
            .order_by(BotMessage.created_at.desc(), BotMessage.id.desc())
            .limit(limit)
        )
        messages = list(reversed(result.scalars().all()))
        return [
            {"role": message.role.value, "content": message.content}
            for message in messages
            if message.content
        ]

    async def add_message(
        self,
        conversation_id: str,
        role: BotMessageRole,
        content: str,
        citations: list | None = None,
        model: str | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
    ) -> BotMessage:
        message = BotMessage(
            bot_conversation_id=conversation_id,
            role=role,
            content=content,
            citations=citations,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
        self.db.add(message)

        # Float the thread to the top of the sidebar on every turn.
        conversation = await self.db.get(BotConversation, conversation_id)
        if conversation is not None:
            conversation.updated_at = datetime.now(timezone.utc)
            if not conversation.title and role == BotMessageRole.USER:
                conversation.title = derive_title(content)
            self.db.add(conversation)

        await self.db.commit()
        await self.db.refresh(message)
        return message
