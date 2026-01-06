"""
Configuration management for CEW AI Assistant Backend.
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Anthropic
    anthropic_api_key: str
    
    # Pinecone
    pinecone_api_key: str
    pinecone_environment: str
    pinecone_index_name: str = "cew-documents"
    
    # Supabase
    supabase_url: str
    supabase_key: str
    
    # App
    environment: str = "development"
    debug: bool = True
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
