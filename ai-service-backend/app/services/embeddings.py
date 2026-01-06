"""
Embedding Service - Generate text embeddings using Anthropic Claude.
"""
from typing import List
import anthropic
from app.config import settings


class EmbeddingService:
    """Service for generating text embeddings."""
    
    def __init__(self):
        """Initialize Anthropic client."""
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    
    def generate_embedding(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.
        
        Args:
            text: Text to embed
            
        Returns:
            List of floats representing the embedding vector
        """
        response = self.client.embeddings.create(
            model="voyage-3",
            input=text
        )
        return response.data[0].embedding
    
    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts in batch.
        
        Args:
            texts: List of texts to embed
            
        Returns:
            List of embedding vectors
        """
        response = self.client.embeddings.create(
            model="voyage-3",
            input=texts
        )
        return [item.embedding for item in response.data]


embedding_service = EmbeddingService()
