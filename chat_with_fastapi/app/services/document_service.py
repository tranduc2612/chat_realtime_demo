import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.llm import embed_texts
from app.core.vectorstore import vector_store
from app.models.document import Document, DocumentStatus
from app.utils.document_parser import chunk_text, extract_text

logger = logging.getLogger(__name__)

# Chunks per embeddings request. One call per chunk would be needlessly chatty;
# one call for a whole book would blow the per-request token ceiling.
EMBED_BATCH_SIZE = 64


class DocumentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self, document_id: str) -> Document | None:
        result = await self.db.execute(
            select(Document).where(Document.id == document_id)
        )
        return result.scalar_one_or_none()

    async def list_all(self) -> list[Document]:
        result = await self.db.execute(
            select(Document).order_by(Document.created_at.desc())
        )
        return list(result.scalars().all())

    async def create_pending(
        self,
        filename: str,
        mime_type: str | None,
        file_size: int,
        uploaded_by_id: str | None,
    ) -> Document:
        """Record the upload before ingesting it, so the UI has a row to poll."""
        document = Document(
            filename=filename,
            mime_type=mime_type,
            file_size=file_size,
            status=DocumentStatus.PENDING,
            uploaded_by_id=uploaded_by_id,
        )
        self.db.add(document)
        await self.db.commit()
        await self.db.refresh(document)
        return document

    async def delete(self, document_id: str) -> bool:
        """Remove a document's chunks from Chroma, then its metadata row.

        Vectors go first on purpose: if Chroma fails, the row survives and the
        document is still listed and deletable. The reverse order would strand
        orphaned chunks that keep grounding answers with no way to find them.
        """
        document = await self.get(document_id)
        if document is None:
            return False

        await vector_store.delete_document(document_id)
        await self.db.delete(document)
        await self.db.commit()
        return True

    async def ready_stats(self) -> tuple[int, int]:
        """(document count, chunk count) across successfully ingested docs."""
        result = await self.db.execute(
            select(
                func.count(Document.id),
                func.coalesce(func.sum(Document.chunk_count), 0),
            ).where(Document.status == DocumentStatus.READY)
        )
        documents, chunks = result.one()
        return int(documents or 0), int(chunks or 0)


async def ingest_document(document_id: str, filename: str, data: bytes) -> None:
    """Parse, chunk, embed and index one uploaded document.

    Runs as a FastAPI BackgroundTask after the upload response is sent, so a
    100-page PDF doesn't hold the request open. It therefore opens its own
    session — the request's session is already closed by the time this runs.
    Every failure path is caught and recorded on the row as FAILED + `error`,
    because a background task that raises would otherwise vanish into the logs
    and leave the document stuck at PROCESSING forever.
    """
    try:
        await _set_status(document_id, DocumentStatus.PROCESSING)

        text = extract_text(filename, data)
        chunks = chunk_text(
            text,
            chunk_size=settings.RAG_CHUNK_SIZE,
            overlap=settings.RAG_CHUNK_OVERLAP,
        )
        if not chunks:
            raise ValueError("No extractable text found in this document")

        embeddings: list[list[float]] = []
        for start in range(0, len(chunks), EMBED_BATCH_SIZE):
            embeddings.extend(await embed_texts(chunks[start:start + EMBED_BATCH_SIZE]))

        await vector_store.add_chunks(
            document_id=document_id,
            filename=filename,
            chunks=chunks,
            embeddings=embeddings,
        )

        await _set_status(document_id, DocumentStatus.READY, chunk_count=len(chunks))
        logger.info("Ingested document %s (%s) as %d chunks", document_id, filename, len(chunks))

    except Exception as exc:
        logger.exception("Failed to ingest document %s (%s)", document_id, filename)
        await vector_store.reset_cache()
        # Any partial chunks would silently ground future answers, so drop them.
        try:
            await vector_store.delete_document(document_id)
        except Exception:
            logger.warning("Could not clean up chunks for failed document %s", document_id)
        await _set_status(document_id, DocumentStatus.FAILED, error=str(exc))


async def _set_status(
    document_id: str,
    status: DocumentStatus,
    chunk_count: int | None = None,
    error: str | None = None,
) -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Document).where(Document.id == document_id))
        document = result.scalar_one_or_none()
        if document is None:
            logger.warning("Document %s disappeared mid-ingest", document_id)
            return

        document.status = status
        document.error = error
        if chunk_count is not None:
            document.chunk_count = chunk_count
        document.updated_at = datetime.now(timezone.utc)
        session.add(document)
        await session.commit()
