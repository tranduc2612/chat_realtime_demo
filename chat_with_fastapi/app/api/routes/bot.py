import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, RequireLLM
from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.models.bot_conversation import BotMessageRole
from app.schemas.bot import (
    AskPayload,
    BotConversationCreate,
    BotConversationResponse,
    BotMessageResponse,
)
from app.services.bot_service import BotService
from app.services.rag_service import rag_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bot", tags=["bot"])


@router.get("/conversations", response_model=list[BotConversationResponse])
async def list_conversations(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[BotConversationResponse]:
    service = BotService(db)
    return await service.list_conversations(current_user.id)


@router.post(
    "/conversations",
    response_model=BotConversationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    data: BotConversationCreate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> BotConversationResponse:
    service = BotService(db)
    return await service.create_conversation(current_user.id, data.title)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    service = BotService(db)
    if not await service.delete_conversation(conversation_id, current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[BotMessageResponse],
)
async def get_messages(
    conversation_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[BotMessageResponse]:
    service = BotService(db)
    if await service.get_conversation(conversation_id, current_user.id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return await service.get_messages(conversation_id)


@router.post("/conversations/{conversation_id}/ask")
async def ask(
    conversation_id: str,
    data: AskPayload,
    _llm: RequireLLM,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Answer a question from the internal documents, streamed as SSE.

    Retrieval happens here rather than inside the generator so an unreachable
    Chroma or a rejected API key surfaces as a real HTTP error the client's
    normal error handling catches. Once streaming starts the status code is
    already committed, so generation failures can only be reported as an
    in-band `error` event.
    """
    service = BotService(db)
    if await service.get_conversation(conversation_id, current_user.id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    question = data.question.strip()
    if not question:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question cannot be empty")

    # Read history before recording this turn — the question is appended
    # separately, bundled with its sources.
    history = await service.history_for_prompt(conversation_id, settings.RAG_MAX_HISTORY)
    await service.add_message(conversation_id, BotMessageRole.USER, question)

    try:
        matches = await rag_service.retrieve(question)
    except Exception:
        logger.exception("Retrieval failed for bot conversation %s", conversation_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not search the internal documents. Please try again.",
        )

    citations = rag_service.build_citations(matches)

    return StreamingResponse(
        _event_stream(conversation_id, question, matches, citations, history),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Tells nginx to stream this response straight through instead of
            # buffering it, which would otherwise hold every token until the
            # answer was complete and defeat the point of streaming.
            "X-Accel-Buffering": "no",
        },
    )


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _event_stream(
    conversation_id: str,
    question: str,
    matches: list[dict],
    citations: list[dict],
    history: list[dict],
) -> AsyncIterator[str]:
    """Emit citations, then answer deltas, then a terminal `done` event.

    Opens its own database session: FastAPI closes dependency-provided sessions
    before the response body is streamed, so `db` from the route is already
    unusable by the time this generator runs.
    """
    yield _sse({"type": "citations", "citations": citations})

    parts: list[str] = []
    usage: dict = {}
    failed = False

    try:
        async for chunk in rag_service.stream_answer(question, matches, history):
            if "delta" in chunk:
                parts.append(chunk["delta"])
                yield _sse({"type": "delta", "content": chunk["delta"]})
            elif "usage" in chunk:
                usage = chunk["usage"] or {}
    except Exception:
        logger.exception("Generation failed for bot conversation %s", conversation_id)
        failed = True
        yield _sse(
            {
                "type": "error",
                "detail": "The assistant stopped unexpectedly. Please try again.",
            }
        )

    answer = "".join(parts)
    message_id = None
    created_at = None

    # Persist whatever was generated — a partial answer is still worth keeping
    # in the thread, and without it the next turn's history would have a user
    # question with no reply.
    if answer:
        try:
            async with AsyncSessionLocal() as session:
                message = await BotService(session).add_message(
                    conversation_id=conversation_id,
                    role=BotMessageRole.ASSISTANT,
                    content=answer,
                    citations=citations or None,
                    model=settings.OPENAI_CHAT_MODEL if matches else None,
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                )
                message_id = message.id
                created_at = message.created_at.isoformat()
        except Exception:
            logger.exception("Could not persist bot answer for conversation %s", conversation_id)

    yield _sse(
        {
            "type": "done",
            "message_id": message_id,
            "created_at": created_at,
            "failed": failed,
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
        }
    )
