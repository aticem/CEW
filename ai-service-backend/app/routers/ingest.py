"""
Ingestion Router - Handles document upload and indexing.
Documents are indexed ONCE and stored in Pinecone.
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from typing import List, Dict, Any
from pydantic import BaseModel
import io
import hashlib
from datetime import datetime
from PyPDF2 import PdfReader

from app.core.metadata import DocumentMetadata, ChunkMetadata, ModuleType
from app.services.embeddings import embedding_service
from app.services.pinecone_service import pinecone_service

router = APIRouter()


class ChunkWithText(BaseModel):
    """Chunk data with text content for API response."""
    metadata: ChunkMetadata
    text: str


class PineconeStatus(BaseModel):
    """Status of Pinecone write operation."""
    success: bool
    upserted_count: int
    message: str


class IngestResponse(BaseModel):
    """Response model for document ingestion."""
    status: str
    document_metadata: DocumentMetadata
    chunks_count: int
    pinecone_status: PineconeStatus
    message: str


class IngestStatusResponse(BaseModel):
    """Response model for ingestion status check."""
    document_id: str
    status: str
    filename: str
    chunks_count: int


def extract_text_from_pdf(file_content: bytes) -> Dict[str, Any]:
    """
    Extract text from PDF file.
    
    Args:
        file_content: Raw PDF file bytes
        
    Returns:
        Dictionary containing extracted text and metadata
    """
    pdf_file = io.BytesIO(file_content)
    reader = PdfReader(pdf_file)
    
    pages_text = []
    total_chars = 0
    
    for page_num, page in enumerate(reader.pages, start=1):
        text = page.extract_text()
        if text:
            pages_text.append({
                "page_number": page_num,
                "text": text,
                "char_count": len(text)
            })
            total_chars += len(text)
    
    return {
        "pages": pages_text,
        "total_pages": len(reader.pages),
        "total_characters": total_chars
    }


def chunk_text(pages_data: List[Dict[str, Any]], chunk_size: int = 1000, chunk_overlap: int = 200) -> List[Dict[str, Any]]:
    """
    Split text into fixed-size chunks with overlap.
    
    Args:
        pages_data: List of page dictionaries with text and metadata
        chunk_size: Maximum characters per chunk (default: 1000)
        chunk_overlap: Characters to overlap between chunks (default: 200)
        
    Returns:
        List of text chunks with metadata
    """
    chunks = []
    chunk_index = 0
    
    for page_data in pages_data:
        page_text = page_data["text"]
        page_number = page_data["page_number"]
        
        start_pos = 0
        while start_pos < len(page_text):
            end_pos = start_pos + chunk_size
            chunk_text = page_text[start_pos:end_pos]
            
            if chunk_text.strip():
                chunks.append({
                    "chunk_index": chunk_index,
                    "page_number": page_number,
                    "text": chunk_text,
                    "char_count": len(chunk_text),
                    "start_char": start_pos,
                    "end_char": end_pos
                })
                chunk_index += 1
            
            start_pos = end_pos - chunk_overlap
            if start_pos >= len(page_text):
                break
    
    return chunks


def generate_document_id(filename: str, content: bytes, project_id: str) -> str:
    """
    Generate a unique document ID based on project, filename and content hash.
    
    Args:
        filename: Original filename
        content: File content bytes
        project_id: CEW project identifier
        
    Returns:
        Unique document ID string
    """
    content_hash = hashlib.sha256(content).hexdigest()[:16]
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    clean_filename = filename.replace(" ", "_").replace(".", "_")[:30]
    return f"{project_id}_doc_{clean_filename}_{timestamp}_{content_hash}"


def generate_chunk_hash(text: str) -> str:
    """
    Generate hash for chunk text for deduplication.
    
    Args:
        text: Chunk text content
        
    Returns:
        SHA256 hash of the text
    """
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


@router.post("/document", response_model=IngestResponse)
async def ingest_document(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    module_type: str = Form(...),
    uploaded_by: str = Form(...)
):
    """
    Upload and process a PDF document with CEW metadata.
    
    Steps:
    1. Validate file type (PDF only for now)
    2. Extract text content from PDF
    3. Chunk the content into fixed-size pieces
    4. Create DocumentMetadata and ChunkMetadata for each chunk
    
    Args:
        file: PDF file to ingest
        project_id: CEW project identifier
        module_type: Type of CEW module (panel, trench, dc_cable, qa, generic)
        uploaded_by: User identifier who is uploading the document
    
    Returns document metadata and prepared chunks (ready for embedding).
    """
    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported in this version"
        )
    
    if module_type not in [mt.value for mt in ModuleType]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid module_type. Must be one of: {[mt.value for mt in ModuleType]}"
        )
    
    content = await file.read()
    
    if len(content) == 0:
        raise HTTPException(
            status_code=400,
            detail="File is empty"
        )
    
    try:
        extracted_data = extract_text_from_pdf(content)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to extract text from PDF: {str(e)}"
        )
    
    if extracted_data["total_characters"] == 0:
        raise HTTPException(
            status_code=400,
            detail="No text could be extracted from PDF. File may be image-based or corrupted."
        )
    
    chunks_data = chunk_text(extracted_data["pages"])
    
    if len(chunks_data) == 0:
        raise HTTPException(
            status_code=400,
            detail="Failed to create text chunks from extracted content"
        )
    
    upload_timestamp = datetime.utcnow()
    content_hash = hashlib.sha256(content).hexdigest()
    document_id = generate_document_id(file.filename, content, project_id)
    file_extension = file.filename.split(".")[-1].lower() if "." in file.filename else "pdf"
    
    document_metadata = DocumentMetadata(
        project_id=project_id,
        module_type=ModuleType(module_type),
        document_id=document_id,
        source_file_name=file.filename,
        uploaded_by=uploaded_by,
        uploaded_at=upload_timestamp,
        file_type=file_extension,
        file_size_bytes=len(content),
        total_chunks=len(chunks_data),
        total_characters=extracted_data["total_characters"],
        content_hash=content_hash
    )
    
    chunks_with_metadata = []
    for chunk in chunks_data:
        chunk_id = f"{document_id}_chunk_{chunk['chunk_index']}"
        chunk_text = chunk["text"]
        chunk_hash = generate_chunk_hash(chunk_text)
        
        chunk_metadata = ChunkMetadata(
            project_id=project_id,
            module_type=ModuleType(module_type),
            document_id=document_id,
            chunk_id=chunk_id,
            source_file_name=file.filename,
            uploaded_by=uploaded_by,
            uploaded_at=upload_timestamp,
            chunk_index=chunk["chunk_index"],
            chunk_hash=chunk_hash,
            page_number=chunk["page_number"],
            chunk_char_count=chunk["char_count"],
            chunk_position_start=chunk.get("start_char"),
            chunk_position_end=chunk.get("end_char")
        )
        
        chunks_with_metadata.append(ChunkWithText(
            metadata=chunk_metadata,
            text=chunk_text
        ))
    
    try:
        chunk_texts = [chunk.text for chunk in chunks_with_metadata]
        embeddings = embedding_service.generate_embeddings(chunk_texts)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate embeddings: {str(e)}"
        )
    
    chunks_metadata_list = [chunk.metadata for chunk in chunks_with_metadata]
    
    try:
        pinecone_result = pinecone_service.upsert_chunks(
            chunks_metadata=chunks_metadata_list,
            embeddings=embeddings,
            texts=chunk_texts
        )
        
        if not pinecone_result["success"]:
            raise HTTPException(
                status_code=500,
                detail=f"Pinecone upsert failed: {pinecone_result['message']}"
            )
        
        pinecone_status = PineconeStatus(
            success=pinecone_result["success"],
            upserted_count=pinecone_result["upserted_count"],
            message=pinecone_result["message"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to write to Pinecone: {str(e)}"
        )
    
    return IngestResponse(
        status="success",
        document_metadata=document_metadata,
        chunks_count=len(chunks_with_metadata),
        pinecone_status=pinecone_status,
        message=f"Document ingested successfully. {len(chunks_with_metadata)} chunks embedded and stored in Pinecone."
    )


@router.get("/status/{document_id}", response_model=IngestStatusResponse)
async def get_ingest_status(document_id: str):
    """
    Check the ingestion status of a document.
    """
    return IngestStatusResponse(
        document_id=document_id,
        status="indexed",
        filename="example.pdf",
        chunks_count=0
    )


@router.get("/documents")
async def list_documents():
    """
    List all indexed documents.
    """
    return {
        "documents": [],
        "total": 0,
        "message": "Document listing skeleton - ready for implementation"
    }
