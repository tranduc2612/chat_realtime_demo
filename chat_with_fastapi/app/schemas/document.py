from datetime import datetime

from pydantic import BaseModel

from app.models.document import DocumentStatus


class DocumentResponse(BaseModel):
    id: str
    filename: str
    mime_type: str | None
    file_size: int
    status: DocumentStatus
    chunk_count: int
    error: str | None
    uploaded_by_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class KnowledgeBaseStats(BaseModel):
    """What the /chat-bot page shows any user about the assistant's grounding."""

    document_count: int
    chunk_count: int
    # False when Chroma is unreachable — the UI warns instead of letting the
    # user ask questions that would silently retrieve nothing.
    vector_store_ready: bool
