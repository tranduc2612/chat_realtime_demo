from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.services.rag_service import NO_CONTEXT_REPLY, RagService


def make_match(filename="handbook.pdf", content="Vacation is 25 days.", distance=0.2, index=0):
    return {
        "content": content,
        "document_id": "doc-1",
        "filename": filename,
        "chunk_index": index,
        "distance": distance,
    }


# ── retrieval ───────────────────────────────────────────────────────────────

async def test_retrieve_passes_configured_top_k_and_distance_ceiling():
    matches = [make_match()]

    with patch("app.services.rag_service.embed_text", AsyncMock(return_value=[0.1, 0.2])), \
         patch("app.services.rag_service.vector_store.query", AsyncMock(return_value=matches)) as query:
        result = await RagService().retrieve("How much vacation?")

    assert result == matches
    query.assert_awaited_once_with(
        embedding=[0.1, 0.2],
        top_k=settings.RAG_TOP_K,
        max_distance=settings.RAG_MAX_DISTANCE,
    )


# ── prompt construction ─────────────────────────────────────────────────────

def test_build_messages_numbers_sources_and_appends_question():
    service = RagService()
    messages = service.build_messages(
        question="How much vacation?",
        matches=[make_match(filename="hr.pdf"), make_match(filename="ops.md")],
        history=[],
    )

    assert messages[0]["role"] == "system"
    final = messages[-1]
    assert final["role"] == "user"
    assert "[1] (from hr.pdf)" in final["content"]
    assert "[2] (from ops.md)" in final["content"]
    assert final["content"].rstrip().endswith("Question: How much vacation?")


def test_build_messages_caps_replayed_history():
    service = RagService()
    history = [{"role": "user", "content": f"turn {i}"} for i in range(settings.RAG_MAX_HISTORY + 10)]

    messages = service.build_messages("now what?", [make_match()], history)

    # system prompt + capped history + the current question
    assert len(messages) == settings.RAG_MAX_HISTORY + 2
    # The cap keeps the most recent turns, not the oldest.
    assert messages[1]["content"] == f"turn {len(history) - settings.RAG_MAX_HISTORY}"


def test_build_messages_truncates_an_oversized_chunk():
    service = RagService()
    messages = service.build_messages("q", [make_match(content="z" * 10_000)], [])

    assert "z" * 4000 in messages[-1]["content"]
    assert "z" * 4001 not in messages[-1]["content"]


def test_build_citations_shape():
    service = RagService()
    citations = service.build_citations([make_match(content="y" * 500, distance=0.123456)])

    assert citations[0]["index"] == 1
    assert citations[0]["filename"] == "handbook.pdf"
    assert citations[0]["distance"] == 0.1235
    # Snippets are trimmed — the UI never needs the whole chunk.
    assert len(citations[0]["snippet"]) == 280


# ── generation ──────────────────────────────────────────────────────────────

async def test_stream_answer_without_matches_skips_the_model():
    service = RagService()

    with patch("app.services.rag_service.get_openai") as get_openai:
        events = [event async for event in service.stream_answer("q", [], [])]

    # Nothing to ground an answer in means no API call at all.
    get_openai.assert_not_called()
    assert events[0] == {"delta": NO_CONTEXT_REPLY}
    assert events[-1]["usage"] == {"prompt_tokens": 0, "completion_tokens": 0}


async def test_stream_answer_yields_deltas_then_usage():
    def chunk(content=None, usage=None):
        choices = [] if content is None else [
            SimpleNamespace(delta=SimpleNamespace(content=content))
        ]
        return SimpleNamespace(choices=choices, usage=usage)

    async def fake_stream():
        yield chunk("Vacation ")
        yield chunk("is 25 days.")
        # The final usage-bearing chunk carries no choices.
        yield chunk(usage=SimpleNamespace(prompt_tokens=800, completion_tokens=12))

    client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=AsyncMock(return_value=fake_stream()))
        )
    )

    with patch("app.services.rag_service.get_openai", return_value=client):
        events = [e async for e in RagService().stream_answer("q", [make_match()], [])]

    assert [e["delta"] for e in events if "delta" in e] == ["Vacation ", "is 25 days."]
    assert events[-1]["usage"] == {"prompt_tokens": 800, "completion_tokens": 12}


async def test_stream_answer_ignores_empty_deltas():
    def chunk(content):
        return SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content=content))], usage=None
        )

    async def fake_stream():
        yield chunk(None)   # role-only opening chunk
        yield chunk("")     # keep-alive
        yield chunk("Hi")

    client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=AsyncMock(return_value=fake_stream()))
        )
    )

    with patch("app.services.rag_service.get_openai", return_value=client):
        events = [e async for e in RagService().stream_answer("q", [make_match()], [])]

    assert [e["delta"] for e in events if "delta" in e] == ["Hi"]
