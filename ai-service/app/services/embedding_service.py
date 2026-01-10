"""
OpenAI embeddings service wrapper.
Provides both async and sync versions for API and ingestion use.
"""
from openai import AsyncOpenAI, OpenAI

from app.config import OPENAI_API_KEY, EMBEDDING_MODEL

# Async client for API endpoints
async_client = None

# Sync client for ingestion script
sync_client = None


def get_async_client() -> AsyncOpenAI:
    """Get or create async OpenAI client."""
    global async_client
    if async_client is None:
        async_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    return async_client


def get_sync_client() -> OpenAI:
    """Get or create sync OpenAI client."""
    global sync_client
    if sync_client is None:
        sync_client = OpenAI(api_key=OPENAI_API_KEY)
    return sync_client


async def generate_embedding(text: str) -> list[float]:
    """
    Generate embedding vector for text using OpenAI (async).
    
    Args:
        text: Text to embed
        
    Returns:
        Embedding vector (1536 dimensions for text-embedding-3-small)
    """
    client = get_async_client()
    
    response = await client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text
    )
    
    return response.data[0].embedding


def generate_embedding_sync(text: str) -> list[float]:
    """
    Generate embedding vector for text using OpenAI (sync).
    Used by the ingestion script.
    
    Args:
        text: Text to embed
        
    Returns:
        Embedding vector (1536 dimensions for text-embedding-3-small)
    """
    client = get_sync_client()
    
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text
    )
    
    return response.data[0].embedding


async def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings for multiple texts in a single API call (async).
    
    Args:
        texts: List of texts to embed
        
    Returns:
        List of embedding vectors
    """
    if not texts:
        return []
    
    client = get_async_client()
    
    response = await client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts
    )
    
    return [item.embedding for item in response.data]
