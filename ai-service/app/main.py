"""
CEW AI Service - FastAPI Application Entry Point

This is the main entry point for the CEW AI backend service.
It provides two modes:
- 'general': RAG-based Q&A from project documents
- 'progress': Data analysis from construction progress records

Run with: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""
import sys

# Fix Windows console encoding for Unicode debug logs (prevents UnicodeEncodeError crashes)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import query, health
from app.config import HOST, PORT

# Create FastAPI application
app = FastAPI(
    title="CEW AI Service",
    description="""
    AI backend for the CEW Solar Construction App.
    
    ## Features
    
    - **General Mode (RAG)**: Answer technical questions from project documents
    - **Progress Mode**: Analyze construction progress data with natural language
    
    ## Language Support
    
    The service automatically detects the language of the question (English or Turkish)
    and responds in the same language.
    
    ## Modes
    
    - `general`: Retrieval-Augmented Generation from indexed documents
    - `progress`: Pandas-based data analysis of progress records
    """,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware - MUST be added immediately after app creation
# Allow ALL origins for development (restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],              # Allow ALL origins
    allow_credentials=False,          # Must be False when origins is "*"
    allow_methods=["*"],              # Allow all HTTP methods
    allow_headers=["*"],              # Allow all headers
)

# Register routers
app.include_router(health.router, tags=["Health"])
app.include_router(query.router, prefix="/api", tags=["Query"])


@app.get("/", tags=["Root"])
async def root():
    """Root endpoint with service information."""
    return {
        "service": "CEW AI Service",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "query": "/api/query",
            "docs": "/docs"
        }
    }


# For running directly with Python
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=True
    )
