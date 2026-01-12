"""
Embedding service wrapper.
Supports:
- OpenAI embeddings (default)
- Gemini embeddings (text-embedding-004) via REST API
"""
import httpx
import requests
from openai import AsyncOpenAI, OpenAI

from app.config import (
    EMBEDDING_MODEL,
    EMBEDDING_PROVIDER,
    GEMINI_API_KEY,
    GEMINI_EMBEDDING_MODEL,
    OPENAI_API_KEY,
)

# Async OpenAI client
_async_openai_client = None

# Sync OpenAI client
_sync_openai_client = None


def _get_async_openai_client() -> AsyncOpenAI:
    global _async_openai_client
    if _async_openai_client is None:
        _async_openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    return _async_openai_client


def _get_sync_openai_client() -> OpenAI:
    global _sync_openai_client
    if _sync_openai_client is None:
        _sync_openai_client = OpenAI(api_key=OPENAI_API_KEY)
    return _sync_openai_client


async def _generate_embedding_openai(text: str) -> list[float]:
    client = _get_async_openai_client()
    response = await client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return response.data[0].embedding


def _generate_embedding_openai_sync(text: str) -> list[float]:
    client = _get_sync_openai_client()
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return response.data[0].embedding


async def _generate_embedding_gemini(text: str) -> list[float]:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is missing for embedding.")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_EMBEDDING_MODEL}:embedContent"
    params = {"key": GEMINI_API_KEY}
    payload = {
        "model": f"models/{GEMINI_EMBEDDING_MODEL}",
        "content": {"parts": [{"text": text}]},
    }

    async with httpx.AsyncClient(timeout=60.0) as c:
        r = await c.post(url, params=params, json=payload)
        r.raise_for_status()
        data = r.json()
    return data["embedding"]["values"]


def _generate_embedding_gemini_sync(text: str) -> list[float]:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is missing for embedding.")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_EMBEDDING_MODEL}:embedContent"
    params = {"key": GEMINI_API_KEY}
    payload = {
        "model": f"models/{GEMINI_EMBEDDING_MODEL}",
        "content": {"parts": [{"text": text}]},
    }

    r = requests.post(url, params=params, json=payload, timeout=60.0)
    r.raise_for_status()
    data = r.json()
    return data["embedding"]["values"]


async def generate_embedding(text: str) -> list[float]:
    """Generate embedding vector for text (async)."""
    if EMBEDDING_PROVIDER == "gemini":
        return await _generate_embedding_gemini(text)
    return await _generate_embedding_openai(text)


def generate_embedding_sync(text: str) -> list[float]:
    """Generate embedding vector for text (sync)."""
    if EMBEDDING_PROVIDER == "gemini":
        return _generate_embedding_gemini_sync(text)
    return _generate_embedding_openai_sync(text)


async def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts in a single call (async)."""
    if not texts:
        return []

    if EMBEDDING_PROVIDER == "gemini":
        # Gemini REST API for batching is batchEmbedContents, 
        # but for simplicity we iterate or implement batch here.
        # Let's do simple iteration for now to ensure stability.
        results = []
        for t in texts:
            results.append(await _generate_embedding_gemini(t))
        return results

    client = _get_async_openai_client()
    response = await client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in response.data]
