"""
RAG (Retrieval-Augmented Generation) pipeline for 'general' mode.
Retrieves relevant document chunks and generates answers.
"""
from app.services.embedding_service import generate_embedding
from app.services.chroma_service import search_documents
from app.services.llm_service import generate_answer
from app.utils.language_detect import detect_language, get_fallback_message
from app.prompts import load_prompt
from app.config import TOP_K_RESULTS, SIMILARITY_THRESHOLD


async def process_rag_query(question: str) -> dict:
    """
    Process a question using the RAG pipeline.
    
    Steps:
    1. Detect language (EN/TR)
    2. Generate embedding for question
    3. Search ChromaDB for relevant chunks
    4. If no relevant results, return fallback
    5. Build prompt with chunks
    6. Call LLM
    7. Return answer with source
    
    Args:
        question: User's natural language question
        
    Returns:
        Dict with 'answer' and 'source' keys
    """
    # Step 1: Detect language
    language = detect_language(question)
    fallback = get_fallback_message(language)
    
    # Step 2: Generate embedding for the question
    try:
        query_embedding = await generate_embedding(question)
    except Exception as e:
        return {
            "answer": f"Error generating embedding: {str(e)}",
            "source": None
        }
    
    # Step 3: Search ChromaDB with high k for structured data
    print(f"\n🔎 DEBUG: Searching ChromaDB with top_k={TOP_K_RESULTS}...")
    results = search_documents(query_embedding, top_k=TOP_K_RESULTS)
    
    print(f"🔎 DEBUG: Retrieved {len(results)} raw results from ChromaDB")
    
    # Step 4: Check if results are relevant
    if not results:
        print(f"❌ DEBUG: No results returned from ChromaDB!")
        return {"answer": fallback, "source": None}
    
    # Filter by similarity threshold
    relevant_results = [r for r in results if r["score"] >= SIMILARITY_THRESHOLD]
    
    print(f"🔎 DEBUG: {len(relevant_results)} results passed similarity threshold ({SIMILARITY_THRESHOLD})")
    
    if not relevant_results:
        print(f"❌ DEBUG: All results below threshold. Top scores: {[r['score'] for r in results[:5]]}")
        return {"answer": fallback, "source": None}
    
    # Step 5: Build prompt with context from chunks
    system_prompt = load_prompt("system_general.txt", language=language)
    
    # Format context from retrieved chunks
    context_parts = []
    for r in relevant_results:
        metadata = r["metadata"]
        doc_name = metadata.get("doc_name", "Unknown Document")
        page = metadata.get("page", "N/A")
        sheet = metadata.get("sheet", None)
        
        location = f"Page {page}" if page != "N/A" else ""
        if sheet:
            location = f"Sheet: {sheet}"
        
        context_parts.append(
            f"[Source: {doc_name} | {location}]\n{r['text']}"
        )
    
    context = "\n\n---\n\n".join(context_parts)
    
    # DEBUG: Print detailed context analysis
    print("\n" + "=" * 80)
    print("🔍 DEBUG RAG CONTEXT (sent to LLM):")
    print("=" * 80)
    print(f"Question: {question}")
    print(f"Language: {language}")
    print(f"Retrieved chunks: {len(relevant_results)}")
    
    # Check for key terms in context
    keywords = ["Jinko", "Brand", "Panel", "Solar", "marka", "brand"]
    found_keywords = [kw for kw in keywords if kw.lower() in context.lower()]
    if found_keywords:
        print(f"✅ KEYWORDS FOUND IN CONTEXT: {', '.join(found_keywords)}")
    else:
        print(f"⚠️  WARNING: No key terms (Jinko, Brand, Panel) found in context!")
    
    print(f"\nTop 5 chunks with scores:")
    for i, r in enumerate(relevant_results[:5], 1):
        score = r["score"]
        text_preview = r["text"][:150].replace("\n", " ")
        print(f"   #{i} [Score: {score:.3f}] {text_preview}...")
    
    print(f"\n(Total context length: {len(context)} characters)")
    print("=" * 80 + "\n")
    
    user_prompt = f"""QUESTION:
{question}

RELEVANT DOCUMENT EXCERPTS:
{context}

Answer the question using ONLY the information above. Cite the source document."""
    
    # Step 6: Call LLM
    try:
        answer = await generate_answer(system_prompt, user_prompt)
    except Exception as e:
        return {
            "answer": f"Error generating answer: {str(e)}",
            "source": None
        }
    
    # Step 7: Extract primary source
    primary_result = relevant_results[0]
    metadata = primary_result["metadata"]
    source = metadata.get("doc_name", "Unknown Document")
    
    page = metadata.get("page")
    sheet = metadata.get("sheet")
    
    if page:
        source += f" (Page {page})"
    elif sheet:
        source += f" (Sheet: {sheet})"
    
    return {"answer": answer, "source": source}
