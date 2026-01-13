"""
ChromaDB service for vector storage and retrieval.
Handles all interactions with the local ChromaDB instance.
"""
import chromadb
from chromadb.config import Settings
import re

from app.config import CHROMA_DIR, CHROMA_COLLECTION_NAME
from app.utils.text_utils import extract_keywords

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


def search_documents_keyword(query_text: str, top_k: int = 20) -> list[dict]:
    """
    Search documents using keyword matching (lexical search).
    
    Args:
        query_text: Natural language query text
        top_k: Number of results to return
        
    Returns:
        List of results with text, metadata, and keyword match score
    """
    collection = get_collection()
    
    # Extract keywords from query (stopwords removed)
    query_keywords = extract_keywords(query_text)
    if not query_keywords:
        return []
    
    # Get all documents (limit to first 2000 for performance)
    # Note: ChromaDB automatically returns ids, don't include it in include parameter
    all_docs = collection.get(limit=2000, include=["documents", "metadatas"])
    
    if not all_docs["ids"]:
        return []
    
    # Score each chunk by keyword matches
    scored_results = []
    query_keywords_lower = [kw.lower() for kw in query_keywords]
    
    for i, doc_id in enumerate(all_docs["ids"]):
        doc_text = (all_docs["documents"][i] or "").lower()
        metadata = all_docs["metadatas"][i] or {}
        
        # Count keyword matches
        matches = sum(1 for kw in query_keywords_lower if kw in doc_text)
        
        if matches > 0:
            # Score: (matched_keywords / total_keywords) * 0.5
            # (0.5 multiplier keeps keyword scores lower than vector scores)
            score = (matches / len(query_keywords_lower)) * 0.5
            
            scored_results.append({
                "id": doc_id,
                "text": all_docs["documents"][i],
                "metadata": metadata,
                "score": score
            })
    
    # Sort by score descending and return top_k
    scored_results.sort(key=lambda x: x["score"], reverse=True)
    return scored_results[:top_k]


def search_documents(
    query_embedding: list[float], 
    top_k: int = 5,
    hybrid: bool = True,
    query_text: str = ""
) -> list[dict]:
    """
    Search for similar documents using embedding (and optionally keyword search).
    
    Args:
        query_embedding: Query vector from embedding service
        top_k: Number of results to return
        hybrid: If True, combine vector and keyword search results
        query_text: Original query text (required if hybrid=True)
        
    Returns:
        List of results with text, metadata, and similarity score
    """
    collection = get_collection()
    
    # Vector search (always performed)
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"]
    )
    
    # Handle empty results
    if not results["ids"] or not results["ids"][0]:
        vector_results = []
    else:
        # Convert to list of dicts with similarity scores
        vector_results = []
        for i, doc_id in enumerate(results["ids"][0]):
            # ChromaDB returns distances, convert to similarity (1 - distance for cosine)
            distance = results["distances"][0][i]
            similarity = 1 - distance
            
            vector_results.append({
                "id": doc_id,
                "text": results["documents"][0][i],
                "metadata": results["metadatas"][0][i],
                "score": similarity
            })
    
    # If hybrid mode, combine with keyword search
    if hybrid and query_text:
        keyword_results = search_documents_keyword(query_text, top_k=top_k * 2)
        
        # Merge results: deduplicate by ID, combine scores
        result_dict = {}
        
        # Add vector results (weight: 1.0)
        for r in vector_results:
            result_dict[r["id"]] = r
        
        # Add keyword results (weight: 0.3, merge if exists)
        for r in keyword_results:
            if r["id"] in result_dict:
                # Merge: add weighted keyword score to existing vector score
                result_dict[r["id"]]["score"] += r["score"] * 0.3
            else:
                # New result from keyword search
                r["score"] *= 0.3  # Scale down keyword-only results
                result_dict[r["id"]] = r
        
        # Convert back to list and sort by score
        output = list(result_dict.values())
        output.sort(key=lambda x: x["score"], reverse=True)
        return output[:top_k]
    
    # Non-hybrid mode: return vector results only
    return vector_results


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


def delete_by_doc_name(doc_name: str) -> int:
    """
    Delete all chunks belonging to a specific source document name.

    Returns:
        Number of deleted items if available, otherwise 0.
    """
    if not doc_name:
        return 0
    collection = get_collection()
    try:
        # Chroma supports metadata filtering deletes
        collection.delete(where={"doc_name": doc_name})
        # Chroma doesn't always return a count; best-effort.
        return 0
    except Exception:
        return 0


def get_collection_stats() -> dict:
    """Get statistics about the collection."""
    collection = get_collection()
    
    return {
        "name": collection.name,
        "count": collection.count()
    }
