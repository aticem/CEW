"""
Query Router - Handles user questions and retrieves information from indexed documents.
The AI Assistant ONLY uses uploaded documents - no external knowledge.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import anthropic

from app.services.embeddings import embedding_service
from app.services.pinecone_service import pinecone_service
from app.config import settings

router = APIRouter()


class Source(BaseModel):
    """Source citation for an answer."""
    document_id: str
    document_name: str
    page_number: Optional[int] = None
    chunk_text: str
    relevance_score: float


class QueryRequest(BaseModel):
    """Request model for asking a question."""
    question: str
    project_id: str
    module_type: Optional[str] = None
    max_sources: int = 5


class QueryResponse(BaseModel):
    """Response model for a query."""
    question: str
    answer: str
    sources: List[Source]
    sources_count: int
    status: str


def build_context_from_chunks(chunks: List[Dict[str, Any]]) -> str:
    """
    Build context string from retrieved chunks.
    
    Args:
        chunks: List of chunks with metadata from Pinecone
        
    Returns:
        Formatted context string
    """
    if not chunks:
        return ""
    
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        metadata = chunk["metadata"]
        text = metadata.get("text", "")
        source_file = metadata.get("source_file_name", "Unknown")
        page_num = metadata.get("page_number")
        
        page_info = f" (Page {page_num})" if page_num else ""
        context_parts.append(
            f"[Source {i}: {source_file}{page_info}]\n{text}\n"
        )
    
    return "\n".join(context_parts)


def generate_answer_with_claude(question: str, context: str) -> str:
    """
    Generate answer using Claude based on provided context.
    
    Args:
        question: User's question
        context: Context from retrieved documents
        
    Returns:
        Generated answer
    """
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    
    system_prompt = """You are a technical AI assistant for a solar farm construction project.

CRITICAL RULES:
1. You may ONLY use information from the provided document context
2. If the information is not in the context, you MUST respond: "This information was not found in the uploaded documents."
3. Do NOT use external knowledge or make assumptions
4. Always cite which source (by number) you're using
5. Be precise and technical
6. If asked about standards or specifications not in the documents, say they are not available

Your role is to retrieve and explain information from project documents, not to provide general knowledge."""

    user_prompt = f"""Context from project documents:

{context}

---

Question: {question}

Answer the question using ONLY the information from the context above. Cite sources by their numbers [Source 1], [Source 2], etc."""

    try:
        message = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2000,
            temperature=0,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_prompt}
            ]
        )
        
        return message.content[0].text
    except Exception as e:
        raise Exception(f"Failed to generate answer with Claude: {str(e)}")


@router.post("/ask", response_model=QueryResponse)
async def ask_question(request: QueryRequest):
    """
    Ask a question based on indexed documents.
    
    Steps:
    1. Validate question
    2. Generate question embedding
    3. Search Pinecone for relevant chunks with project/module filters
    4. Build context from chunks
    5. Send to Claude with strict prompt (ONLY use provided context)
    6. Return answer with source citations
    
    Args:
        request: QueryRequest with question, project_id, optional module_type
        
    Returns:
        QueryResponse with answer and sources
    """
    if not request.question or len(request.question.strip()) < 3:
        raise HTTPException(
            status_code=400,
            detail="Question must be at least 3 characters long"
        )
    
    try:
        query_embedding = embedding_service.generate_embedding(request.question)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate query embedding: {str(e)}"
        )
    
    filter_dict = {"project_id": request.project_id}
    if request.module_type:
        filter_dict["module_type"] = request.module_type
    
    try:
        search_results = pinecone_service.query_vectors(
            query_embedding=query_embedding,
            top_k=request.max_sources,
            filter_dict=filter_dict
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to search Pinecone: {str(e)}"
        )
    
    if not search_results:
        return QueryResponse(
            question=request.question,
            answer="This information was not found in the uploaded documents.",
            sources=[],
            sources_count=0,
            status="no_results"
        )
    
    context = build_context_from_chunks(search_results)
    
    try:
        answer = generate_answer_with_claude(request.question, context)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate answer: {str(e)}"
        )
    
    sources = []
    for result in search_results:
        metadata = result["metadata"]
        sources.append(Source(
            document_id=metadata.get("document_id", "unknown"),
            document_name=metadata.get("source_file_name", "Unknown"),
            page_number=metadata.get("page_number"),
            chunk_text=metadata.get("text", "")[:500],
            relevance_score=result["score"]
        ))
    
    return QueryResponse(
        question=request.question,
        answer=answer,
        sources=sources,
        sources_count=len(sources),
        status="success"
    )


@router.get("/history")
async def get_query_history():
    """
    Get query history for the current session/project.
    """
    return {
        "queries": [],
        "total": 0,
        "message": "Query history skeleton - ready for implementation"
    }
