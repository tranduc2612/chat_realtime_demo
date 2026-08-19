from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AdminUser, CurrentUser, RequireLLM
from app.core.config import settings
from app.core.database import get_db
from app.core.vectorstore import vector_store
from app.schemas.document import DocumentResponse, KnowledgeBaseStats
from app.services.document_service import DocumentService, ingest_document
from app.utils.document_parser import SUPPORTED_EXTENSIONS, is_supported

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/stats", response_model=KnowledgeBaseStats)
async def knowledge_base_stats(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> KnowledgeBaseStats:
    """Readable by any signed-in user — the chat page shows what's indexed.

    Intentionally not admin-gated and not LLM-gated: it exposes only counts,
    and the page needs it precisely when the assistant is unavailable.
    """
    service = DocumentService(db)
    document_count, chunk_count = await service.ready_stats()
    return KnowledgeBaseStats(
        document_count=document_count,
        chunk_count=chunk_count,
        vector_store_ready=await vector_store.health(),
    )


@router.get("", response_model=list[DocumentResponse])
async def list_documents(
    current_user: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> list[DocumentResponse]:
    service = DocumentService(db)
    return await service.list_all()


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    _llm: RequireLLM,
    current_user: AdminUser,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    """Accept an internal document and index it in the background.

    Returns immediately with status=pending; the client polls GET /documents
    until the row flips to ready or failed. The bytes are held in memory and
    handed to the background task rather than written to disk — nothing here
    needs a volume shared between the three backend replicas.
    """
    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A filename is required",
        )
    if not is_supported(filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    data = await file.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is empty",
        )

    max_bytes = settings.RAG_MAX_UPLOAD_MB * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {settings.RAG_MAX_UPLOAD_MB} MB limit",
        )

    service = DocumentService(db)
    document = await service.create_pending(
        filename=filename,
        mime_type=file.content_type,
        file_size=len(data),
        uploaded_by_id=current_user.id,
    )

    background_tasks.add_task(ingest_document, document.id, filename, data)
    return DocumentResponse.model_validate(document)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str,
    current_user: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    service = DocumentService(db)
    if not await service.delete(document_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )
