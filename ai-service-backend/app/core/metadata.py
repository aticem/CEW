"""
Global CEW Metadata Contract

This module defines the standard metadata structure used by ALL CEW modules
for document and chunk tracking across the AI Assistant system.
"""
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field
from enum import Enum


class ModuleType(str, Enum):
    """CEW module types for document categorization."""
    PANEL = "panel"
    TRENCH = "trench"
    DC_CABLE = "dc_cable"
    QA = "qa"
    GENERIC = "generic"


class DocumentMetadata(BaseModel):
    """
    Metadata for a complete document ingested into the system.
    Used for tracking and organizing documents across all CEW modules.
    """
    project_id: str = Field(
        ...,
        description="Unique identifier for the CEW project"
    )
    
    module_type: ModuleType = Field(
        ...,
        description="Type of CEW module this document belongs to"
    )
    
    document_id: str = Field(
        ...,
        description="Unique identifier for this document"
    )
    
    source_file_name: str = Field(
        ...,
        description="Original filename of the uploaded document"
    )
    
    uploaded_by: str = Field(
        ...,
        description="User identifier who uploaded the document"
    )
    
    uploaded_at: datetime = Field(
        ...,
        description="Timestamp when document was uploaded (UTC)"
    )
    
    file_type: str = Field(
        ...,
        description="File type/extension (pdf, xlsx, etc.)"
    )
    
    file_size_bytes: int = Field(
        ...,
        description="Size of the original file in bytes"
    )
    
    total_chunks: int = Field(
        ...,
        description="Total number of chunks created from this document"
    )
    
    total_characters: int = Field(
        ...,
        description="Total character count extracted from document"
    )
    
    content_hash: str = Field(
        ...,
        description="SHA256 hash of the document content for deduplication"
    )
    
    metadata_version: str = Field(
        default="1.0",
        description="Version of the metadata schema"
    )
    
    additional_metadata: Optional[dict] = Field(
        default=None,
        description="Optional module-specific metadata"
    )


class ChunkMetadata(BaseModel):
    """
    Metadata for a single text chunk from a document.
    Used for vector embedding and retrieval across all CEW modules.
    """
    project_id: str = Field(
        ...,
        description="Unique identifier for the CEW project"
    )
    
    module_type: ModuleType = Field(
        ...,
        description="Type of CEW module this chunk belongs to"
    )
    
    document_id: str = Field(
        ...,
        description="Parent document identifier"
    )
    
    chunk_id: str = Field(
        ...,
        description="Unique identifier for this chunk"
    )
    
    source_file_name: str = Field(
        ...,
        description="Original filename of the source document"
    )
    
    uploaded_by: str = Field(
        ...,
        description="User identifier who uploaded the parent document"
    )
    
    uploaded_at: datetime = Field(
        ...,
        description="Timestamp when parent document was uploaded (UTC)"
    )
    
    chunk_index: int = Field(
        ...,
        description="Sequential index of this chunk within the document"
    )
    
    chunk_hash: str = Field(
        ...,
        description="Hash of the chunk text for deduplication"
    )
    
    page_number: Optional[int] = Field(
        default=None,
        description="Page number in source document (if applicable)"
    )
    
    chunk_char_count: int = Field(
        ...,
        description="Character count of this chunk"
    )
    
    chunk_position_start: Optional[int] = Field(
        default=None,
        description="Start character position in original document"
    )
    
    chunk_position_end: Optional[int] = Field(
        default=None,
        description="End character position in original document"
    )
    
    metadata_version: str = Field(
        default="1.0",
        description="Version of the metadata schema"
    )
    
    additional_metadata: Optional[dict] = Field(
        default=None,
        description="Optional module-specific metadata"
    )
    
    class Config:
        """Pydantic configuration."""
        use_enum_values = True
