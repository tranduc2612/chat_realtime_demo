from datetime import datetime

from pydantic import BaseModel, Field

from app.models.bot_conversation import BotMessageRole


class Citation(BaseModel):
    """One retrieved chunk, as surfaced next to an assistant answer."""

    index: int
    document_id: str | None = None
    filename: str | None = None
    chunk_index: int | None = None
    snippet: str = ""
    # Cosine distance from the question (0 = identical). Lower is a closer match.
    distance: float = 0.0


class BotMessageResponse(BaseModel):
    id: str
    bot_conversation_id: str
    role: BotMessageRole
    content: str
    citations: list[Citation] | None = None
    model: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BotConversationResponse(BaseModel):
    id: str
    user_id: str
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BotConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)


class AskPayload(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
