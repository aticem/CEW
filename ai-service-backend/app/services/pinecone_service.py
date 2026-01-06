"""
Pinecone Service - Handles vector storage and retrieval.
"""
from typing import List, Dict, Any, Optional
from pinecone import Pinecone, ServerlessSpec
from app.config import settings
from app.core.metadata import ChunkMetadata


class PineconeService:
    """Service for managing Pinecone vector database operations."""
    
    def __init__(self):
        """Initialize Pinecone client and ensure index exists."""
        self.pc = Pinecone(api_key=settings.pinecone_api_key)
        self.index_name = settings.pinecone_index_name
        self.dimension = 1024
        self._ensure_index_exists()
    
    def _ensure_index_exists(self):
        """Create Pinecone index if it doesn't exist."""
        existing_indexes = [index.name for index in self.pc.list_indexes()]
        
        if self.index_name not in existing_indexes:
            self.pc.create_index(
                name=self.index_name,
                dimension=self.dimension,
                metric="cosine",
                spec=ServerlessSpec(
                    cloud="aws",
                    region=settings.pinecone_environment
                )
            )
    
    def get_index(self):
        """Get the Pinecone index instance."""
        return self.pc.Index(self.index_name)
    
    def upsert_chunks(
        self,
        chunks_metadata: List[ChunkMetadata],
        embeddings: List[List[float]],
        texts: List[str]
    ) -> Dict[str, Any]:
        """
        Upsert chunks with embeddings to Pinecone.
        
        Args:
            chunks_metadata: List of ChunkMetadata objects
            embeddings: List of embedding vectors
            texts: List of chunk texts
            
        Returns:
            Dictionary with upsert result statistics
        """
        if len(chunks_metadata) != len(embeddings) != len(texts):
            raise ValueError("chunks_metadata, embeddings, and texts must have the same length")
        
        index = self.get_index()
        
        vectors = []
        for chunk_meta, embedding, text in zip(chunks_metadata, embeddings, texts):
            metadata_dict = {
                "project_id": chunk_meta.project_id,
                "module_type": chunk_meta.module_type,
                "document_id": chunk_meta.document_id,
                "chunk_index": chunk_meta.chunk_index,
                "chunk_hash": chunk_meta.chunk_hash,
                "source_file_name": chunk_meta.source_file_name,
                "uploaded_by": chunk_meta.uploaded_by,
                "uploaded_at": chunk_meta.uploaded_at.isoformat(),
                "page_number": chunk_meta.page_number,
                "chunk_char_count": chunk_meta.chunk_char_count,
                "text": text[:1000]
            }
            
            vectors.append({
                "id": chunk_meta.chunk_id,
                "values": embedding,
                "metadata": metadata_dict
            })
        
        try:
            upsert_response = index.upsert(vectors=vectors)
            return {
                "success": True,
                "upserted_count": upsert_response.upserted_count,
                "message": f"Successfully upserted {upsert_response.upserted_count} vectors"
            }
        except Exception as e:
            return {
                "success": False,
                "upserted_count": 0,
                "message": f"Failed to upsert vectors: {str(e)}"
            }
    
    def query_vectors(
        self,
        query_embedding: List[float],
        top_k: int = 5,
        filter_dict: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Query Pinecone for similar vectors.
        
        Args:
            query_embedding: Query vector
            top_k: Number of results to return
            filter_dict: Optional metadata filters
            
        Returns:
            List of matching results with metadata
        """
        index = self.get_index()
        
        try:
            results = index.query(
                vector=query_embedding,
                top_k=top_k,
                filter=filter_dict,
                include_metadata=True
            )
            
            return [
                {
                    "id": match.id,
                    "score": match.score,
                    "metadata": match.metadata
                }
                for match in results.matches
            ]
        except Exception as e:
            raise Exception(f"Failed to query vectors: {str(e)}")
    
    def delete_by_document_id(self, document_id: str) -> Dict[str, Any]:
        """
        Delete all chunks belonging to a document.
        
        Args:
            document_id: Document ID to delete
            
        Returns:
            Dictionary with deletion result
        """
        index = self.get_index()
        
        try:
            index.delete(filter={"document_id": document_id})
            return {
                "success": True,
                "message": f"Deleted all chunks for document {document_id}"
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"Failed to delete chunks: {str(e)}"
            }


pinecone_service = PineconeService()
