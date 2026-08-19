"""OpenAI client access, gated on OPENAI_API_KEY the way Sentry is on its DSN.

Nothing here is constructed at import time: with no key configured the app
still boots and every non-chatbot route behaves normally — only /api/v1/bot and
/api/v1/documents fail, and they fail as a clean 503 via `require_llm()` rather
than an AttributeError deep inside a request.
"""
import logging

from openai import AsyncOpenAI

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None


def llm_enabled() -> bool:
    return bool(settings.OPENAI_API_KEY)


def get_openai() -> AsyncOpenAI:
    """Return the process-wide AsyncOpenAI client, creating it on first use.

    The client holds an httpx connection pool, so it's deliberately shared
    across requests instead of rebuilt per call.
    """
    global _client
    if _client is None:
        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        _client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            timeout=settings.OPENAI_TIMEOUT_SECONDS,
        )
    return _client


async def close_openai() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of strings, preserving input order.

    Batched in one request per call: the embeddings endpoint accepts a list,
    and one round trip for a whole document beats one per chunk.
    """
    if not texts:
        return []

    client = get_openai()
    response = await client.embeddings.create(
        model=settings.OPENAI_EMBEDDING_MODEL,
        input=texts,
        dimensions=settings.OPENAI_EMBEDDING_DIMENSIONS,
    )
    # The API may return items out of order; `index` is authoritative.
    ordered = sorted(response.data, key=lambda item: item.index)
    return [item.embedding for item in ordered]


async def embed_text(text: str) -> list[float]:
    vectors = await embed_texts([text])
    return vectors[0]
