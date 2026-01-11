"""
Application configuration.
Load from environment variables with sensible defaults.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Base paths
BASE_DIR = Path(__file__).parent.parent
DOCUMENTS_DIR = BASE_DIR / "documents"
CHROMA_DIR = BASE_DIR / "chroma_db"
PROMPTS_DIR = BASE_DIR / "app" / "prompts"

# Load .env file (stable path; not dependent on current working directory)
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

# Ensure directories exist
DOCUMENTS_DIR.mkdir(exist_ok=True)
CHROMA_DIR.mkdir(exist_ok=True)

# OpenAI
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o")  # Enterprise mode: Maximum reasoning capability
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

# ChromaDB
CHROMA_COLLECTION_NAME = "cew_documents"

# RAG settings
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
TOP_K_RESULTS = 60  # High Recall: Smart model needs enough data for complex inference
SIMILARITY_THRESHOLD = 0.0  # DISABLED - Let all results through, LLM filters by relevance

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
