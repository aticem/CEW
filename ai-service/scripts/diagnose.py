#!/usr/bin/env python3
"""
RAG DIAGNOSTIC SCRIPT

This script traces the EXACT data flow for a query without using the API.
It checks each step of the RAG pipeline to identify where the chain breaks.

Usage:
    cd ai-service
    python scripts/diagnose.py

Test Query: "Panel markası nedir?" (What is the panel brand?)
Expected Data: Should find "Jinko" or "Jinko Solar" in the documents
"""
import sys
from pathlib import Path
import asyncio

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.chroma_service import get_collection, search_documents
from app.services.embedding_service import generate_embedding_sync, generate_embedding
from app.config import TOP_K_RESULTS, SIMILARITY_THRESHOLD


def check_a_raw_db_search():
    """
    CHECK A: Raw Database Search
    
    Query ChromaDB directly for keywords like "Jinko", "Panel", "Brand"
    to verify the data actually exists in the database.
    """
    print("\n" + "=" * 80)
    print("CHECK A: RAW DATABASE SEARCH")
    print("=" * 80)
    print("Testing if 'Jinko', 'Panel', 'Brand' exist in ChromaDB raw data...")
    
    try:
        collection = get_collection()
        
        # Get all documents (or a large sample)
        results = collection.get(
            limit=1000,  # Get many documents
            include=["documents", "metadatas"]
        )
        
        if not results["ids"]:
            print("\n❌ FAIL: ChromaDB collection is EMPTY!")
            print("   Action: Run 'python scripts/ingest.py' to load data")
            return False
        
        print(f"\n✓ Collection has {len(results['ids'])} documents")
        
        # Search for keywords
        keywords = ["Jinko", "jinko", "Panel", "panel", "Brand", "brand", "Solar"]
        found_docs = []
        
        for keyword in keywords:
            print(f"\n   Searching for '{keyword}'...")
            count = 0
            
            for i, doc_text in enumerate(results["documents"]):
                if keyword.lower() in doc_text.lower():
                    count += 1
                    if count <= 3:  # Show first 3 matches
                        found_docs.append({
                            "keyword": keyword,
                            "doc_id": results["ids"][i],
                            "text": doc_text[:300]
                        })
            
            if count > 0:
                print(f"   ✅ Found '{keyword}' in {count} documents")
            else:
                print(f"   ❌ NOT found: '{keyword}'")
        
        if found_docs:
            print(f"\n✅ CHECK A PASSED: Data exists in ChromaDB!")
            print(f"\nSample matches (first 3):")
            for i, doc in enumerate(found_docs[:3], 1):
                print(f"\n   Match #{i} - Keyword: '{doc['keyword']}'")
                print(f"   ID: {doc['doc_id']}")
                print(f"   Text preview: {doc['text'][:200]}...")
            return True
        else:
            print(f"\n❌ CHECK A FAILED: Keywords NOT found in database!")
            print(f"   This means the data was not properly ingested.")
            print(f"   Action: Check ingestion script and re-run")
            return False
            
    except Exception as e:
        print(f"\n❌ ERROR in Check A: {e}")
        import traceback
        traceback.print_exc()
        return False


async def check_b_retriever_logic():
    """
    CHECK B: Retriever Logic
    
    Use the EXACT retrieval logic from rag_service.py to see if the
    relevant documents are being retrieved for the query.
    """
    print("\n" + "=" * 80)
    print("CHECK B: RETRIEVER LOGIC")
    print("=" * 80)
    
    test_query = "Panel markası nedir?"
    print(f"Test Query: '{test_query}'")
    print(f"Settings: TOP_K={TOP_K_RESULTS}, SIMILARITY_THRESHOLD={SIMILARITY_THRESHOLD}")
    
    try:
        # Step 1: Generate embedding (same as rag_service.py)
        print(f"\n[1/3] Generating query embedding...")
        query_embedding = await generate_embedding(test_query)
        print(f"   ✓ Embedding generated ({len(query_embedding)} dimensions)")
        
        # Step 2: Search ChromaDB (same as rag_service.py)
        print(f"\n[2/3] Searching ChromaDB for top {TOP_K_RESULTS} results...")
        results = search_documents(query_embedding, top_k=TOP_K_RESULTS)
        
        if not results:
            print(f"\n❌ CHECK B FAILED: No documents retrieved!")
            print(f"   This is very unusual if Check A passed.")
            print(f"   Possible causes:")
            print(f"   - Query embedding is not similar to document embeddings")
            print(f"   - SIMILARITY_THRESHOLD ({SIMILARITY_THRESHOLD}) is too high")
            return False
        
        print(f"   ✓ Retrieved {len(results)} documents")
        
        # Step 3: Filter by similarity threshold (same as rag_service.py)
        print(f"\n[3/3] Filtering by similarity threshold ({SIMILARITY_THRESHOLD})...")
        relevant_results = [r for r in results if r["score"] >= SIMILARITY_THRESHOLD]
        
        print(f"   ✓ {len(relevant_results)} documents passed threshold")
        
        if not relevant_results:
            print(f"\n❌ CHECK B FAILED: All documents below similarity threshold!")
            print(f"   Retrieved {len(results)} docs, but none scored >= {SIMILARITY_THRESHOLD}")
            print(f"   Top scores: {[r['score'] for r in results[:5]]}")
            print(f"   Action: Lower SIMILARITY_THRESHOLD in config.py")
            return False
        
        # Check if "Jinko" or "Brand" is in the retrieved context
        print(f"\n📊 Analyzing retrieved content...")
        print(f"\nTop {min(5, len(relevant_results))} results:")
        
        found_keywords = False
        keywords_to_check = ["Jinko", "Brand", "Solar", "Panel", "marka"]
        
        for i, result in enumerate(relevant_results[:5], 1):
            text = result["text"]
            score = result["score"]
            metadata = result["metadata"]
            
            print(f"\n   Result #{i}:")
            print(f"   Score: {score:.4f}")
            print(f"   Doc: {metadata.get('doc_name', 'Unknown')}")
            print(f"   Content: {text[:200]}...")
            
            # Check for keywords
            found_in_this = [kw for kw in keywords_to_check if kw.lower() in text.lower()]
            if found_in_this:
                print(f"   🎯 CONTAINS: {', '.join(found_in_this)}")
                found_keywords = True
        
        # Show all results summary
        print(f"\n📋 Summary of all {len(relevant_results)} retrieved documents:")
        for i, result in enumerate(relevant_results, 1):
            text = result["text"]
            found_in_this = [kw for kw in keywords_to_check if kw.lower() in text.lower()]
            if found_in_this:
                print(f"   Doc #{i}: ✅ Contains: {', '.join(found_in_this)}")
        
        if found_keywords:
            print(f"\n✅ CHECK B PASSED: Relevant data IS being retrieved!")
            print(f"   The context contains the information needed to answer.")
            return True
        else:
            print(f"\n❌ CHECK B FAILED: Retrieved documents do NOT contain the answer!")
            print(f"   Retrieved {len(relevant_results)} docs, but none contain keywords.")
            print(f"   Diagnosis: TOP_K_RESULTS ({TOP_K_RESULTS}) is TOO LOW")
            print(f"   Action: Increase TOP_K_RESULTS to 50 or 100 in config.py")
            return False
            
    except Exception as e:
        print(f"\n❌ ERROR in Check B: {e}")
        import traceback
        traceback.print_exc()
        return False


async def check_c_llm_context():
    """
    CHECK C: LLM Context
    
    Show exactly what would be sent to the LLM, formatted exactly as
    rag_service.py does it.
    """
    print("\n" + "=" * 80)
    print("CHECK C: LLM CONTEXT PREVIEW")
    print("=" * 80)
    print("Showing the EXACT context that would be sent to the LLM...")
    
    test_query = "Panel markası nedir?"
    
    try:
        # Generate embedding
        query_embedding = await generate_embedding(test_query)
        
        # Search
        results = search_documents(query_embedding, top_k=TOP_K_RESULTS)
        relevant_results = [r for r in results if r["score"] >= SIMILARITY_THRESHOLD]
        
        if not relevant_results:
            print(f"\n⚠️  Cannot build context - no relevant results from Check B")
            return False
        
        # Build context EXACTLY as rag_service.py does
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
        
        # Build user prompt EXACTLY as rag_service.py does
        user_prompt = f"""QUESTION:
{test_query}

RELEVANT DOCUMENT EXCERPTS:
{context}

Answer the question using ONLY the information above. Cite the source document."""
        
        print(f"\n📝 LLM would receive:")
        print(f"   - System prompt: from system_general.txt")
        print(f"   - User prompt length: {len(user_prompt)} characters")
        print(f"   - Context length: {len(context)} characters")
        print(f"   - Number of chunks: {len(relevant_results)}")
        
        print(f"\n🔍 Full context that would be sent to LLM:")
        print("=" * 80)
        print(context)
        print("=" * 80)
        
        print(f"\n📤 Full user prompt:")
        print("=" * 80)
        print(user_prompt)
        print("=" * 80)
        
        # Final check
        keywords = ["Jinko", "Brand", "marka", "Solar"]
        found_in_context = [kw for kw in keywords if kw.lower() in context.lower()]
        
        if found_in_context:
            print(f"\n✅ CHECK C PASSED: Context contains answer!")
            print(f"   Found keywords: {', '.join(found_in_context)}")
            print(f"\n📊 DIAGNOSIS:")
            print(f"   - Data exists in DB ✓")
            print(f"   - Retriever finds data ✓")
            print(f"   - Context sent to LLM ✓")
            print(f"\n   If AI still says 'not found', the problem is:")
            print(f"   🎯 SYSTEM PROMPT is too restrictive")
            print(f"   🎯 LLM doesn't understand structured data format")
            print(f"\n   Action: Update system_general.txt to be more lenient")
            return True
        else:
            print(f"\n⚠️  WARNING: Context does NOT contain obvious keywords")
            print(f"   This suggests the answer is not in the retrieved chunks.")
            return False
            
    except Exception as e:
        print(f"\n❌ ERROR in Check C: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """Run all diagnostic checks."""
    print("\n" + "=" * 80)
    print("🔬 RAG PIPELINE DIAGNOSTIC TOOL")
    print("=" * 80)
    print("Query: 'Panel markası nedir?' (What is the panel brand?)")
    print("Expected: Should find 'Jinko Solar' or similar in documents")
    print("=" * 80)
    
    # Check A: Raw DB
    check_a_passed = check_a_raw_db_search()
    
    if not check_a_passed:
        print("\n" + "=" * 80)
        print("🛑 STOPPED: Data not found in ChromaDB")
        print("=" * 80)
        print("\n🔧 SOLUTION:")
        print("   1. Delete chroma_db/ folder")
        print("   2. Run: python scripts/ingest.py")
        print("   3. Re-run this diagnostic")
        return
    
    # Check B: Retriever
    check_b_passed = await check_b_retriever_logic()
    
    if not check_b_passed:
        print("\n" + "=" * 80)
        print("🛑 STOPPED: Retriever not finding relevant data")
        print("=" * 80)
        print("\n🔧 SOLUTION:")
        print("   Problem: TOP_K_RESULTS is too low for structured data")
        print("   Fix: Edit app/config.py")
        print("   Change: TOP_K_RESULTS = 5  →  TOP_K_RESULTS = 50")
        print("   Reason: Structured data = many small chunks, need more results")
        return
    
    # Check C: LLM Context
    check_c_passed = await check_c_llm_context()
    
    print("\n" + "=" * 80)
    print("🎯 DIAGNOSTIC COMPLETE")
    print("=" * 80)
    
    if check_a_passed and check_b_passed and check_c_passed:
        print("\n✅ ALL CHECKS PASSED!")
        print("\n📊 CONCLUSION:")
        print("   The RAG pipeline is working correctly.")
        print("   Data exists, retriever finds it, context is sent to LLM.")
        print("\n   If AI still fails to answer:")
        print("   🔧 Fix: Update app/prompts/system_general.txt")
        print("   Make the system prompt more flexible for structured data.")
    else:
        print("\n❌ SOME CHECKS FAILED")
        print("   Review the output above for specific fixes.")
    
    print("\n" + "=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
