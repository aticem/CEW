"""
ChromaDB service for vector storage and retrieval.
Handles all interactions with the local ChromaDB instance.
"""
import chromadb
from chromadb.config import Settings

from app.config import CHROMA_DIR, CHROMA_COLLECTION_NAME

# ChromaDB client (lazy initialization)
_chroma_client = None
_collection = None


def get_chroma_client():
    """Get or create ChromaDB client with persistent storage."""
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(
            path=str(CHROMA_DIR),
            settings=Settings(anonymized_telemetry=False)
        )
    return _chroma_client


def get_collection():
    """Get or create the documents collection."""
    global _collection
    if _collection is None:
        client = get_chroma_client()
        _collection = client.get_or_create_collection(
            name=CHROMA_COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"}
        )
    return _collection


def search_documents(
    query_embedding: list[float], 
    top_k: int = 5
) -> list[dict]:
    """
    Search for similar documents using embedding.
    
    Args:
        query_embedding: Query vector from embedding service
        top_k: Number of results to return
        
    Returns:
        List of results with text, metadata, and similarity score
    """
    collection = get_collection()
    
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"]
    )
    
    # Handle empty results
    if not results["ids"] or not results["ids"][0]:
        return []
    
    # Convert to list of dicts with similarity scores
    output = []
    for i, doc_id in enumerate(results["ids"][0]):
        # ChromaDB returns distances, convert to similarity (1 - distance for cosine)
        distance = results["distances"][0][i]
        similarity = 1 - distance
        
        output.append({
            "id": doc_id,
            "text": results["documents"][0][i],
            "metadata": results["metadatas"][0][i],
            "score": similarity
        })
    
    return output


def add_documents(documents: list[dict]) -> int:
    """
    Add documents to ChromaDB.
    
    Args:
        documents: List of dicts with {id, text, embedding, metadata}
        
    Returns:
        Number of documents added
    """
    if not documents:
        return 0
    
    collection = get_collection()
    
    collection.add(
        ids=[doc["id"] for doc in documents],
        documents=[doc["text"] for doc in documents],
        embeddings=[doc["embedding"] for doc in documents],
        metadatas=[doc["metadata"] for doc in documents]
    )
    
    return len(documents)


def clear_collection() -> None:
    """Delete and recreate collection (for re-ingestion)."""
    global _collection
    
    client = get_chroma_client()
    
    try:
        client.delete_collection(CHROMA_COLLECTION_NAME)
    except Exception:
        pass  # Collection may not exist
    
    # Reset cached collection
    _collection = None
    
    # Recreate collection
    get_collection()


def get_collection_stats() -> dict:
    """Get statistics about the collection."""
    collection = get_collection()
    
    return {
        "name": collection.name,
        "count": collection.count()
    }
