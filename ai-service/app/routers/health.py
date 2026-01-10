"""
Health check endpoint.
Used to verify the service is running.
"""
from fastapi import APIRouter

from app.services.chroma_service import get_collection_stats

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Health check endpoint.
    Returns service status and ChromaDB stats.
    """
    try:
        chroma_stats = get_collection_stats()
        chroma_status = "connected"
    except Exception as e:
        chroma_stats = {"error": str(e)}
        chroma_status = "error"
    
    return {
        "status": "healthy",
        "version": "1.0.0",
        "service": "cew-ai-service",
        "chroma": {
            "status": chroma_status,
            "documents": chroma_stats.get("count", 0)
        }
    }
