from datetime import datetime, timezone
from enum import Enum as PyEnum
import uuid

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class BotMessageRole(str, PyEnum):
    USER = "user"
    ASSISTANT = "assistant"


class BotConversation(Base):
    """A user's thread with the RAG assistant.

    Deliberately separate from `conversations`/`messages`: a bot thread has one
    human member (no membership table, no read receipts, no WebSocket
    broadcast) and carries per-turn RAG metadata — citations and token usage —
    that has no meaning for human-to-human chat.
    """

    __tablename__ = "bot_conversations"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Derived from the first question asked (see BotService.create) rather than
    # spending an extra LLM call on titling.
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user = relationship("User")

    messages = relationship(
        "BotMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # Sidebar query: this user's threads, most recently used first.
        Index("ix_bot_conversations_user_updated", "user_id", "updated_at"),
    )


class BotMessage(Base):
    __tablename__ = "bot_messages"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    bot_conversation_id: Mapped[str] = mapped_column(
        ForeignKey("bot_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    role: Mapped[BotMessageRole] = mapped_column(
        Enum(BotMessageRole),
        nullable=False,
    )

    content: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Assistant turns only: the chunks that grounded the answer, as
    # [{"document_id", "filename", "chunk_index", "snippet", "distance"}, ...].
    citations: Mapped[list | None] = mapped_column(JSON, nullable=True)

    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    conversation = relationship("BotConversation", back_populates="messages")

    __table_args__ = (
        Index("ix_bot_messages_conversation_created", "bot_conversation_id", "created_at"),
    )
