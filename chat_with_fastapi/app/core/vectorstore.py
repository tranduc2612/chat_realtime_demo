"""ChromaDB access for the RAG knowledge base.

Runs against a standalone Chroma *server* (the `chroma` service in each
docker-compose file), not an embedded PersistentClient: the backend runs three
replicas behind nginx, and three processes writing one embedded SQLite file
would race. An HTTP server means all replicas share one index, the same way
they already share one MySQL and one Redis.

Embeddings are always supplied explicitly by the caller (from OpenAI, see
app/core/llm.py), so the collection is created with `embedding_function: None`
— Chroma is never asked to embed anything itself.
"""
import asyncio
import logging
from typing import Any

import chromadb

from app.core.config import settings

logger = logging.getLogger(__name__)

# Chroma rejects oversized writes; documents are added in slices of this many
# chunks so a large PDF doesn't fail as one giant request.
ADD_BATCH_SIZE = 100


class VectorStore:
    def __init__(self) -> None:
        self._client: Any = None
        self._collection: Any = None
        # Guards lazy init: without it, concurrent first requests on the same
        # worker would each build a client and race to create the collection.
        self._lock = asyncio.Lock()

    async def _get_collection(self) -> Any:
        if self._collection is not None:
            return self._collection

        async with self._lock:
            if self._collection is not None:
                return self._collection

            self._client = await chromadb.AsyncHttpClient(
                host=settings.CHROMA_HOST,
                port=settings.CHROMA_PORT,
            )
            self._collection = await self._client.get_or_create_collection(
                name=settings.CHROMA_COLLECTION,
                configuration={
                    # Cosine distance: 0 = identical, 2 = opposite. RAG_MAX_DISTANCE
                    # is interpreted against this scale.
                    "hnsw": {"space": "cosine"},
                    "embedding_function": None,
                },
            )
            return self._collection

    async def reset_cache(self) -> None:
        """Drop the cached handles so the next call reconnects.

        Called after a failure — a collection deleted out from under us, or a
        Chroma restart — so one bad request doesn't poison the worker.
        """
        async with self._lock:
            self._client = None
            self._collection = None

    async def health(self) -> bool:
        try:
            collection = await self._get_collection()
            await collection.count()
            return True
        except Exception:
            logger.warning("Chroma health check failed", exc_info=True)
            await self.reset_cache()
            return False

    async def add_chunks(
        self,
        document_id: str,
        filename: str,
        chunks: list[str],
        embeddings: list[list[float]],
    ) -> None:
        """Store one document's chunks. Ids are deterministic (`<doc-id>:<n>`)
        so re-ingesting the same document overwrites rather than duplicates."""
        collection = await self._get_collection()

        for start in range(0, len(chunks), ADD_BATCH_SIZE):
            stop = start + ADD_BATCH_SIZE
            batch = chunks[start:stop]
            await collection.upsert(
                ids=[f"{document_id}:{start + i}" for i in range(len(batch))],
                documents=batch,
                embeddings=embeddings[start:stop],
                metadatas=[
                    {
                        "document_id": document_id,
                        "filename": filename,
                        "chunk_index": start + i,
                    }
                    for i in range(len(batch))
                ],
            )

    async def delete_document(self, document_id: str) -> None:
        collection = await self._get_collection()
        await collection.delete(where={"document_id": document_id})

    async def query(
        self,
        embedding: list[float],
        top_k: int,
        max_distance: float | None = None,
    ) -> list[dict]:
        """Return the nearest chunks as plain dicts, closest first.

        Anything further than `max_distance` is dropped, so a question the
        documents don't cover retrieves nothing at all and the caller can say
        so instead of grounding on the least-bad match.
        """
        collection = await self._get_collection()
        result = await collection.query(
            query_embeddings=[embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )

        # Chroma nests results one level per query embedding; we only send one.
        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]

        matches: list[dict] = []
        for content, metadata, distance in zip(documents, metadatas, distances):
            if max_distance is not None and distance > max_distance:
                continue
            metadata = metadata or {}
            matches.append(
                {
                    "content": content,
                    "document_id": metadata.get("document_id"),
                    "filename": metadata.get("filename"),
                    "chunk_index": metadata.get("chunk_index"),
                    "distance": float(distance),
                }
            )
        return matches


vector_store = VectorStore()
