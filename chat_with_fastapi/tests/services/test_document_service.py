from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.document import Document, DocumentStatus
from app.services.document_service import DocumentService, ingest_document
from tests.conftest import make_result


# ── service ─────────────────────────────────────────────────────────────────

async def test_get_returns_document(mock_db):
    document = Document(id="doc-1", filename="handbook.pdf")
    mock_db.execute.return_value = make_result(scalar_one_or_none=document)

    assert await DocumentService(mock_db).get("doc-1") is document


async def test_list_all(mock_db):
    documents = [Document(id="doc-1"), Document(id="doc-2")]
    mock_db.execute.return_value = make_result(scalars_all=documents)

    assert await DocumentService(mock_db).list_all() == documents


async def test_create_pending_starts_in_pending_status(mock_db):
    document = await DocumentService(mock_db).create_pending(
        filename="handbook.pdf",
        mime_type="application/pdf",
        file_size=2048,
        uploaded_by_id="user-a",
    )

    assert document.status == DocumentStatus.PENDING
    assert document.filename == "handbook.pdf"
    assert document.uploaded_by_id == "user-a"
    mock_db.add.assert_called_once_with(document)
    mock_db.commit.assert_awaited_once()


async def test_delete_removes_vectors_before_the_row(mock_db):
    document = Document(id="doc-1", filename="handbook.pdf")
    mock_db.execute.return_value = make_result(scalar_one_or_none=document)
    order: list[str] = []

    async def track_vectors(_id):
        order.append("vectors")

    async def track_row(_obj):
        order.append("row")

    mock_db.delete = AsyncMock(side_effect=track_row)

    with patch("app.services.document_service.vector_store.delete_document", AsyncMock(side_effect=track_vectors)):
        assert await DocumentService(mock_db).delete("doc-1") is True

    # Vectors first: a failure there must leave the row (and so the document's
    # delete button) in place rather than stranding orphaned chunks.
    assert order == ["vectors", "row"]


async def test_delete_missing_document_returns_false(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)

    with patch("app.services.document_service.vector_store.delete_document", AsyncMock()) as delete:
        assert await DocumentService(mock_db).delete("nope") is False

    delete.assert_not_awaited()


async def test_ready_stats(mock_db):
    result = MagicMock()
    result.one.return_value = (3, 128)
    mock_db.execute.return_value = result

    assert await DocumentService(mock_db).ready_stats() == (3, 128)


async def test_ready_stats_handles_empty_knowledge_base(mock_db):
    result = MagicMock()
    result.one.return_value = (0, None)  # SUM() over no rows
    mock_db.execute.return_value = result

    assert await DocumentService(mock_db).ready_stats() == (0, 0)


# ── background ingestion ────────────────────────────────────────────────────

async def test_ingest_document_happy_path():
    statuses = []

    async def record_status(document_id, status, chunk_count=None, error=None):
        statuses.append((status, chunk_count, error))

    with patch("app.services.document_service._set_status", AsyncMock(side_effect=record_status)), \
         patch("app.services.document_service.embed_texts", AsyncMock(return_value=[[0.1]])) as embed, \
         patch("app.services.document_service.vector_store.add_chunks", AsyncMock()) as add_chunks:
        await ingest_document("doc-1", "notes.md", b"Some internal policy text.")

    assert statuses[0][0] == DocumentStatus.PROCESSING
    assert statuses[-1][0] == DocumentStatus.READY
    assert statuses[-1][1] == 1  # chunk_count
    embed.assert_awaited_once()
    add_chunks.assert_awaited_once()
    assert add_chunks.await_args.kwargs["document_id"] == "doc-1"


async def test_ingest_document_batches_embedding_calls():
    # Force many chunks out of a long document, then assert they're embedded in
    # batches rather than one request per chunk or one giant request.
    text = ("word " * 60 + "\n\n") * 200

    with patch("app.services.document_service._set_status", AsyncMock()), \
         patch("app.services.document_service.EMBED_BATCH_SIZE", 10), \
         patch("app.services.document_service.embed_texts", AsyncMock(side_effect=lambda batch: [[0.0]] * len(batch))) as embed, \
         patch("app.services.document_service.vector_store.add_chunks", AsyncMock()) as add_chunks:
        await ingest_document("doc-1", "big.md", text.encode())

    assert embed.await_count > 1
    assert all(len(call.args[0]) <= 10 for call in embed.await_args_list)
    # One embedding per chunk, in order.
    chunks = add_chunks.await_args.kwargs["chunks"]
    assert len(add_chunks.await_args.kwargs["embeddings"]) == len(chunks)


async def test_ingest_document_marks_failed_when_text_is_empty():
    statuses = []

    async def record_status(document_id, status, chunk_count=None, error=None):
        statuses.append((status, error))

    with patch("app.services.document_service._set_status", AsyncMock(side_effect=record_status)), \
         patch("app.services.document_service.vector_store.delete_document", AsyncMock()), \
         patch("app.services.document_service.vector_store.reset_cache", AsyncMock()), \
         patch("app.services.document_service.embed_texts", AsyncMock()) as embed:
        await ingest_document("doc-1", "blank.txt", b"   \n\n  ")

    assert statuses[-1][0] == DocumentStatus.FAILED
    assert "No extractable text" in statuses[-1][1]
    embed.assert_not_awaited()


async def test_ingest_document_records_failure_and_cleans_up_partial_chunks():
    statuses = []

    async def record_status(document_id, status, chunk_count=None, error=None):
        statuses.append((status, error))

    with patch("app.services.document_service._set_status", AsyncMock(side_effect=record_status)), \
         patch("app.services.document_service.embed_texts", AsyncMock(side_effect=RuntimeError("rate limited"))), \
         patch("app.services.document_service.vector_store.reset_cache", AsyncMock()), \
         patch("app.services.document_service.vector_store.delete_document", AsyncMock()) as cleanup:
        # Must not raise: a background task that propagates would leave the
        # document stuck at PROCESSING with nothing recorded.
        await ingest_document("doc-1", "notes.md", b"Some text.")

    assert statuses[-1][0] == DocumentStatus.FAILED
    assert "rate limited" in statuses[-1][1]
    cleanup.assert_awaited_once_with("doc-1")


async def test_ingest_document_unsupported_type_is_recorded_not_raised():
    statuses = []

    async def record_status(document_id, status, chunk_count=None, error=None):
        statuses.append((status, error))

    with patch("app.services.document_service._set_status", AsyncMock(side_effect=record_status)), \
         patch("app.services.document_service.vector_store.reset_cache", AsyncMock()), \
         patch("app.services.document_service.vector_store.delete_document", AsyncMock()):
        await ingest_document("doc-1", "payload.exe", b"MZ")

    assert statuses[-1][0] == DocumentStatus.FAILED
    assert "Unsupported file type" in statuses[-1][1]
