"""
Query endpoint for AI-powered Q&A.
Routes to RAG or Data pipeline based on mode.
Supports screen_context for real-time data injection.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from app.services.rag_service import process_rag_query
from app.services.data_service import process_data_query

router = APIRouter()


class QueryRequest(BaseModel):
    """Request model for /api/query endpoint."""
    question: str = Field(
        ..., 
        min_length=1, 
        max_length=1000,
        description="The user's question in natural language"
    )
    mode: str = Field(
        ..., 
        pattern="^(general|progress)$",
        description="Query mode: 'general' for RAG, 'progress' for data analysis"
    )
    screen_context: Optional[dict] = Field(
        None,
        description="Real-time data from the user's screen (module name, totals, completed, etc.)"
    )
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "question": "What is the minimum trench depth?",
                    "mode": "general"
                },
                {
                    "question": "What is the total work done?",
                    "mode": "progress",
                    "screen_context": {
                        "module": "DC Cable Pulling",
                        "total": 18112,
                        "completed": 5420,
                        "remaining": 12692,
                        "unit": "strings"
                    }
                }
            ]
        }
    }


class QueryResponse(BaseModel):
    """Response model for /api/query endpoint."""
    answer: str = Field(
        ...,
        description="AI-generated answer to the question"
    )
    source: str | None = Field(
        None,
        description="Source document or database reference"
    )


@router.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    """
    Process a user question using AI.
    
    - **mode='general'**: Uses RAG pipeline to search documents and generate answers
    - **mode='progress'**: Uses Pandas to analyze progress data and generate summaries
    - **screen_context**: Optional real-time data from user's screen (prioritized in progress mode)
    
    The AI will respond in the same language as the question (English or Turkish).
    """
    try:
        if request.mode == "general":
            result = await process_rag_query(request.question)
        elif request.mode == "progress":
            result = await process_data_query(
                question=request.question,
                screen_context=request.screen_context
            )
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid mode: {request.mode}. Must be 'general' or 'progress'"
            )
        
        return QueryResponse(
            answer=result["answer"],
            source=result.get("source")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )
