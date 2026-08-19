"""Retrieval-augmented generation over the ingested internal documents.

The flow for one question:

  1. embed the question with the same model used at ingest time
  2. pull the nearest chunks from Chroma, dropping anything past RAG_MAX_DISTANCE
  3. build a grounded prompt: system rules + numbered sources + recent history
  4. stream the completion back token by token

No fine-tuning is involved — the model is never trained on the documents. They
are retrieved fresh on every question, so editing or deleting a document takes
effect on the very next answer.
"""
import logging
from typing import AsyncIterator

from app.core.config import settings
from app.core.llm import embed_text, get_openai
from app.core.vectorstore import vector_store

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the internal knowledge assistant for this company.

Answer strictly from the numbered sources supplied in the user message. Follow these rules:

- Base every factual claim on the sources. Never use outside knowledge to fill gaps.
- Cite the sources you used inline as [1], [2], matching the numbering given.
- If the sources do not contain the answer, say plainly that the internal
  documents do not cover it. Do not guess, and do not apologise at length.
- If the sources partially answer the question, answer that part and say
  explicitly which part is not covered.
- Prefer quoting exact figures, names and dates from the sources over paraphrase.
- Answer in the language the user asked in.
- Be concise and use Markdown for structure when it helps."""

NO_CONTEXT_REPLY = (
    "I couldn't find anything about that in the internal documents. "
    "Try rephrasing the question, or ask an admin to upload the relevant document."
)

# Truncates any single retrieved chunk before it goes into the prompt, so one
# pathologically long chunk can't crowd out the other sources.
MAX_CHUNK_CHARS = 4000


class RagService:
    async def retrieve(self, question: str) -> list[dict]:
        """Return the chunks that should ground this question, closest first."""
        embedding = await embed_text(question)
        return await vector_store.query(
            embedding=embedding,
            top_k=settings.RAG_TOP_K,
            max_distance=settings.RAG_MAX_DISTANCE,
        )

    def build_messages(
        self,
        question: str,
        matches: list[dict],
        history: list[dict],
    ) -> list[dict]:
        """Assemble the chat payload: system rules, prior turns, then sources.

        Sources are attached to the *current* question rather than sent as a
        separate system message, so the model can tell which turn they belong
        to when the history contains earlier, differently-grounded answers.
        """
        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

        for turn in history[-settings.RAG_MAX_HISTORY:]:
            messages.append({"role": turn["role"], "content": turn["content"]})

        blocks = []
        for i, match in enumerate(matches, start=1):
            content = (match.get("content") or "")[:MAX_CHUNK_CHARS]
            blocks.append(f"[{i}] (from {match.get('filename')})\n{content}")

        messages.append(
            {
                "role": "user",
                "content": (
                    "Sources:\n\n"
                    + "\n\n---\n\n".join(blocks)
                    + f"\n\n---\n\nQuestion: {question}"
                ),
            }
        )
        return messages

    def build_citations(self, matches: list[dict]) -> list[dict]:
        """Compact, UI-facing view of the sources — no full chunk text."""
        return [
            {
                "index": i,
                "document_id": match.get("document_id"),
                "filename": match.get("filename"),
                "chunk_index": match.get("chunk_index"),
                "snippet": (match.get("content") or "")[:280],
                "distance": round(match.get("distance", 0.0), 4),
            }
            for i, match in enumerate(matches, start=1)
        ]

    async def stream_answer(
        self,
        question: str,
        matches: list[dict],
        history: list[dict],
    ) -> AsyncIterator[dict]:
        """Yield {"delta": str} chunks, then a final {"usage": {...}}.

        With no matches the model is skipped entirely: there is nothing to
        ground an answer in, and asking anyway invites the invention this whole
        design exists to prevent.
        """
        if not matches:
            yield {"delta": NO_CONTEXT_REPLY}
            yield {"usage": {"prompt_tokens": 0, "completion_tokens": 0}}
            return

        client = get_openai()
        stream = await client.chat.completions.create(
            model=settings.OPENAI_CHAT_MODEL,
            messages=self.build_messages(question, matches, history),
            stream=True,
            # Ask the API to report usage on the final chunk; without this a
            # streamed completion reports nothing and token counts stay null.
            stream_options={"include_usage": True},
        )

        usage = {"prompt_tokens": None, "completion_tokens": None}
        async for event in stream:
            if event.usage is not None:
                usage = {
                    "prompt_tokens": event.usage.prompt_tokens,
                    "completion_tokens": event.usage.completion_tokens,
                }
            # The usage-bearing final chunk carries an empty `choices` list.
            if not event.choices:
                continue
            delta = event.choices[0].delta
            if delta and delta.content:
                yield {"delta": delta.content}

        yield {"usage": usage}


rag_service = RagService()
