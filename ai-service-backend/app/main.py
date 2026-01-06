"""
CEW AI Assistant Backend - Main FastAPI Application
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings

app = FastAPI(
    title="CEW AI Assistant Backend",
    description="Document-grounded AI Assistant for solar farm projects",
    version="0.1.0",
    debug=settings.debug
)

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "CEW AI Assistant Backend",
        "version": "0.1.0",
        "environment": settings.environment
    }


@app.get("/health")
async def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "services": {
            "api": "operational",
            "anthropic": "configured" if settings.anthropic_api_key else "not configured",
            "pinecone": "configured" if settings.pinecone_api_key else "not configured",
            "supabase": "configured" if settings.supabase_url else "not configured"
        }
    }


# Import and include routers
from app.routers import ingest, query

app.include_router(ingest.router, prefix="/api/ingest", tags=["ingestion"])
app.include_router(query.router, prefix="/api/query", tags=["query"])
