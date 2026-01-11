"""
RAG (Retrieval-Augmented Generation) pipeline for 'general' mode.
Retrieves relevant document chunks and generates answers.
"""
import re

from app.services.embedding_service import generate_embedding
from app.services.chroma_service import search_documents, get_collection
from app.services.llm_service import generate_answer
from app.utils.language_detect import detect_language, get_fallback_message
from app.prompts import load_prompt
from app.config import TOP_K_RESULTS, SIMILARITY_THRESHOLD
from app.utils.text_utils import extract_keywords


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
    # Recall-first: retrieve more than we will send to the LLM, then filter down.
    retrieval_top_k = max(TOP_K_RESULTS, 120)
    print(f"\n🔎 DEBUG: Searching ChromaDB with top_k={retrieval_top_k}...")
    results = search_documents(query_embedding, top_k=retrieval_top_k)
    
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

    # Lexical augmentation for high-recall cable queries (helps when user asks in TR but docs are EN).
    # This is intentionally conservative and only triggers on obvious cable intent.
    ql = (question or "").lower()
    if re.search(r"\b(kablo|cable)\b", ql):
        try:
            collection = get_collection()
            all_docs = collection.get(limit=2000, include=["documents", "metadatas"])
            docs = all_docs.get("documents") or []
            metas = all_docs.get("metadatas") or []
            ids = all_docs.get("ids") or []

            lexical_terms = [
                "cable type",
                "cross section",
                "mm2",
                "mm²",
                "h1z2z2",
            ]

            existing_ids = {r.get("id") for r in relevant_results}
            added = 0
            for doc_id, doc_text, meta in zip(ids, docs, metas):
                if doc_id in existing_ids:
                    continue
                t = (doc_text or "").lower()
                if any(term in t for term in lexical_terms):
                    relevant_results.append(
                        {
                            "id": doc_id,
                            "text": doc_text,
                            "metadata": meta or {},
                            # No distance available from collection.get; treat as low-priority.
                            "score": 0.0,
                        }
                    )
                    existing_ids.add(doc_id)
                    added += 1

            if added:
                print(f"🔎 DEBUG: Lexical augmentation added {added} cable-related chunks")
        except Exception as _e:
            # Never fail the request due to augmentation; proceed with vector results.
            pass
    
    # Step 5: Smart filter (reduce noise while keeping recall)
    # Goal: Keep keyword-matching chunks (high precision) + top-scoring remainder (recall safety net).
    def _select_chunks(
        q: str,
        items: list[dict],
        max_chunks: int = 25,
        preferred_keyword_chunks: int = 15,
    ) -> list[dict]:
        if not items:
            return []

        q_lower = (q or "").lower()
        kws = []
        try:
            kws = extract_keywords(q) or []
        except Exception:
            kws = []

        # Add simple fallback keywords for TR/EN (keeps recall even if extract_keywords is weak)
        raw_tokens = re.findall(r"\b[0-9A-Za-zğüşöçıİĞÜŞÖÇ]+\b", q_lower)
        for t in raw_tokens:
            if len(t) <= 2:
                continue
            if t.isdigit():
                continue
            kws.append(t)

        # De-dupe keywords while preserving order
        seen_kw = set()
        uniq_kws = []
        for kw in kws:
            kw = str(kw).strip().lower()
            if not kw:
                continue
            if kw in seen_kw:
                continue
            seen_kw.add(kw)
            uniq_kws.append(kw)

        if not uniq_kws:
            return items[:max_chunks]

        # Lightweight TR→EN keyword expansion (helps recall when documents are in English but the query is Turkish).
        # Keep this small and conservative (substring match) to avoid over-broad filtering.
        expansions: list[str] = []
        if any(kw in uniq_kws for kw in ["kablo", "kabllo", "kblo"]):
            expansions.extend(["cable"])
        if any("metraj" in kw for kw in uniq_kws):
            expansions.extend(["length", "meter", "meters"])
        if any(kw in uniq_kws for kw in ["marka", "markası", "mrakası", "brand"]):
            expansions.extend(["brand", "manufacturer"])
        if any(kw in uniq_kws for kw in ["inverter", "inveter"]):
            expansions.extend(["inverter", "sungrow", "sg350"])

        for ex in expansions:
            ex = ex.strip().lower()
            if ex and ex not in seen_kw:
                seen_kw.add(ex)
                uniq_kws.append(ex)

        def has_kw(text: str) -> bool:
            t = (text or "").lower()
            return any(kw in t for kw in uniq_kws)

        kw_hits = [r for r in items if has_kw(r.get("text", ""))]
        rest = [r for r in items if r not in kw_hits]

        selected = []

        # Cable questions are often ambiguous; ensure DC/AC/MV diversity if possible (prevents \"only one cable\" answers).
        ql = (q or "").lower()
        if re.search(r"\b(kablo|cable)\b", ql):
            def find_anchor(pred) -> dict | None:
                for rr in items:
                    if pred((rr.get("text") or "").lower()):
                        return rr
                return None

            dc_anchor = find_anchor(lambda t: ("dc" in t) or ("h1z2z2" in t))
            ac_anchor = find_anchor(lambda t: ("ac" in t) or ("lv" in t) or ("0.6/1" in t))
            mv_anchor = find_anchor(lambda t: ("mv" in t) or ("medium voltage" in t) or ("xlpe" in t))

            for a in [dc_anchor, ac_anchor, mv_anchor]:
                if a and a not in selected:
                    selected.append(a)

        selected.extend(kw_hits[:preferred_keyword_chunks])
        if len(selected) < max_chunks:
            selected.extend(rest[: (max_chunks - len(selected))])

        # De-dupe by id
        out = []
        seen_ids = set()
        for r in selected:
            rid = r.get("id")
            if rid in seen_ids:
                continue
            seen_ids.add(rid)
            out.append(r)
        return out

    selected_results = _select_chunks(question, relevant_results)

    # Step 6: Build prompt with context from selected chunks
    system_prompt = load_prompt("system_general.txt", language=language)
    
    # Format context from retrieved chunks
    context_parts = []
    for r in selected_results:
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
    print(f"Selected chunks (sent to LLM): {len(selected_results)}")
    
    # Check for key terms in context
    keywords = ["Jinko", "Brand", "Panel", "Solar", "marka", "brand"]
    found_keywords = [kw for kw in keywords if kw.lower() in context.lower()]
    if found_keywords:
        print(f"✅ KEYWORDS FOUND IN CONTEXT: {', '.join(found_keywords)}")
    else:
        print(f"⚠️  WARNING: No key terms (Jinko, Brand, Panel) found in context!")
    
    print(f"\nTop 5 chunks with scores:")
    for i, r in enumerate(selected_results[:5], 1):
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
    primary_result = (selected_results[0] if selected_results else relevant_results[0])
    metadata = primary_result["metadata"]
    source = metadata.get("doc_name", "Unknown Document")
    
    page = metadata.get("page")
    sheet = metadata.get("sheet")
    
    if page:
        source += f" (Page {page})"
    elif sheet:
        source += f" (Sheet: {sheet})"
    
    return {"answer": answer, "source": source}
