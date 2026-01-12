"""
RAG (Retrieval-Augmented Generation) pipeline for 'general' mode.
Retrieves relevant document chunks and generates answers.
"""
import re
from collections import defaultdict

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

    # Lexical augmentation for bat box / ecology queries (multi-doc can otherwise drift into Excel).
    if re.search(r"\b(bat\s*box|batbox|bat\s*boxes|yarasa)\b", ql):
        try:
            collection = get_collection()
            all_docs = collection.get(limit=2000, include=["documents", "metadatas"])
            docs = all_docs.get("documents") or []
            metas = all_docs.get("metadatas") or []
            ids = all_docs.get("ids") or []

            lexical_terms = [
                "bat box",
                "bat boxes",
                "batbox",
                "yarasa",
                "ecological",
                "planting",
                "hedgerow",
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
                            "score": 0.0,
                        }
                    )
                    existing_ids.add(doc_id)
                    added += 1

            if added:
                print(f"🔎 DEBUG: Lexical augmentation added {added} ecology-related chunks")
        except Exception:
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

        def infer_doc_type(doc_name: str, meta: dict) -> str:
            dt = (meta or {}).get("doc_type")
            if dt:
                return str(dt).lower()
            dn = (doc_name or "").lower()
            if dn.endswith(".pdf"):
                return "pdf"
            if dn.endswith(".docx") or dn.endswith(".doc"):
                return "word"
            if dn.endswith(".xlsx") or dn.endswith(".xls"):
                return "excel"
            return "unknown"

        # Intent hints for doc-type aware prioritization (multi-doc)
        intent_ecology = bool(re.search(r"\b(planting|hedgerow|ecolog|lemp|tyler|grange|bat\s*box|yarasa)\b", q_lower))
        intent_inverter = bool(re.search(r"\b(inverter|inverte|sg350|sungrow)\b", q_lower))
        kws = []
        try:
            kws = extract_keywords(q) or []
        except Exception:
            kws = []

        # Add simple fallback keywords for TR/EN (keeps recall even if extract_keywords is weak)
        raw_tokens = re.findall(r"\b[0-9A-Za-zğüşöçıİĞÜŞÖÇ]+\b", q_lower)
        allow_short_units = {"m", "mm", "v", "kv", "a", "hz", "%", "wp", "w", "kw", "mw"}
        for t in raw_tokens:
            tl = t.lower()
            # Keep important short units (mm, m, kV, V, %, etc.)
            if len(tl) <= 2 and tl not in allow_short_units:
                continue
            # Keep numeric tokens too (critical for exact-value questions like 50mm, 5-10, 1080V)
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

        # If query is explicitly about "bat box" (ecology), constrain to PDFs if any exist.
        # This prevents drifting into electrical "junction box/switch box" chunks.
        if re.search(r"\bbat\s*box\b|\bbatbox\b|\bbat\s*boxes\b", q_lower):
            pdf_items = []
            for r in items:
                meta = r.get("metadata") or {}
                dn = str(meta.get("doc_name") or "")
                if infer_doc_type(dn, meta) == "pdf":
                    pdf_items.append(r)
            if pdf_items:
                items = pdf_items

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

        # Special handling: "bat box" queries should NOT treat "box" as a standalone keyword
        # (it matches "junction box", "switch box", etc. and causes wrong doc drift).
        if re.search(r"\bbat\s*box\b|\bbatbox\b|\bbat\s*boxes\b", q_lower):
            uniq_kws = [kw for kw in uniq_kws if kw not in {"box"}]
            for kw in ["bat box", "batbox", "bat boxes", "yarasa"]:
                if kw not in seen_kw:
                    seen_kw.add(kw)
                    uniq_kws.append(kw)

        def has_kw(text: str) -> bool:
            t = (text or "").lower()
            return any(kw in t for kw in uniq_kws)

        # Doc-type aware boost: for ecology questions, prefer PDFs; for inverter/equipment, prefer Word+Excel.
        def boosted_sort_key(r: dict) -> tuple:
            meta = r.get("metadata") or {}
            dn = str(meta.get("doc_name") or "")
            dt = infer_doc_type(dn, meta)
            score = float(r.get("score") or 0.0)
            boost = 0.0
            if intent_ecology:
                if dt == "pdf":
                    boost += 2.0
                if "landscape" in dn.lower() or "ecological" in dn.lower():
                    boost += 1.0
                if dt == "excel":
                    boost -= 1.0
            if intent_inverter:
                if dt in ("word", "excel"):
                    boost += 1.0
                if "technical description" in dn.lower():
                    boost += 1.0
            return (-(score + boost), dn)

        kw_hits = [r for r in items if has_kw(r.get("text", ""))]
        rest = [r for r in items if r not in kw_hits]
        kw_hits.sort(key=boosted_sort_key)
        rest.sort(key=boosted_sort_key)

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

    # WHY/RISK/WHAT-HAPPENS strict handling:
    # - If the user asks for reasons/risks/consequences and the context does not explicitly state a reason,
    #   we MUST NOT infer. Return fallback + relevant excerpts (mentions) WITHOUT explaining causality.
    def _is_why_intent(q: str) -> bool:
        ql = (q or "").lower()
        return bool(
            re.search(
                r"\b(why|neden|niye|riskli|ne olur|nolur|what happens|issue|problem|illegal|ceza|yasak|suçlu|sorumlu|daha iyi mi|olursa)\b",
                ql,
            )
        )

    def _context_has_explicit_reason(items: list[dict]) -> bool:
        patterns = [
            r"\bbecause\b",
            r"\bin order to\b",
            r"\bto avoid\b",
            r"\bto prevent\b",
            r"\bso that\b",
            r"\btherefore\b",
            r"\bçünkü\b",
            r"\bbu nedenle\b",
            r"\bamacıyla\b",
            r"\bönlemek için\b",
        ]
        for r in items or []:
            tl = (r.get("text") or "").lower()
            if any(re.search(p, tl) for p in patterns):
                return True
        return False

    def _build_mentions(items: list[dict], max_n: int = 5) -> tuple[str | None, list[str]]:
        doc_names = []
        mentions = []
        for r in (items or [])[:25]:
            meta = r.get("metadata") or {}
            dn = meta.get("doc_name")
            if dn and dn not in doc_names:
                doc_names.append(dn)

            text = (r.get("text") or "").strip()
            if not text:
                continue

            page = meta.get("page")
            sheet = meta.get("sheet")
            table_num = meta.get("table_num")
            loc = None
            if table_num is not None:
                loc = f"Table: {table_num}"
            elif sheet:
                loc = f"Sheet: {sheet}"
            elif page:
                loc = f"Page: {page}"

            snippet = text.replace("\n", " ")
            snippet = re.sub(r"\s+", " ", snippet).strip()
            snippet = snippet[:220] + ("…" if len(snippet) > 220 else "")
            cite = f"[Kaynak: {dn}{', ' + loc if loc else ''}]"
            mentions.append(f'- "{snippet}" {cite}')
            if len(mentions) >= max_n:
                break
        source_list = ", ".join(doc_names[:5]) if doc_names else None
        return source_list, mentions

    if _is_why_intent(question) and not _context_has_explicit_reason(selected_results):
        source_list, mentions = _build_mentions(selected_results, max_n=5)
        ans = fallback
        if source_list:
            ans = f"{ans} [Kaynak: {source_list}]"
        if mentions:
            ans = ans + "\n\nİLGİLİ BULGULAR (NEDEN/SONUÇ AÇIKLANMIYOR):\n" + "\n".join(mentions)
        return {"answer": ans, "source": source_list}

    # Deterministic aggregation for "how many inverters" / "kaç tane inverter" questions.
    def _extract_kv_pairs_from_data(text: str) -> list[tuple[str, str]]:
        if not text or "DATA:" not in text:
            return []
        _, after = text.split("DATA:", 1)
        after = after.strip()
        if not after:
            return []
        out = []
        for m in re.finditer(
            r"(?P<key>[^:]{1,120}):\s*(?P<val>.*?)(?=(?:,\s*[^:]{1,120}:\s*)|$)",
            after,
            flags=re.DOTALL,
        ):
            k = m.group("key").strip()
            v = m.group("val").strip()
            if k and v:
                out.append((k, v))
        return out

    def _try_answer_total_inverters(q: str, items: list[dict]) -> dict | None:
        ql = (q or "").lower()
        if not re.search(r"\b(inverter|inverte)\b", ql):
            return None
        if not re.search(r"\b(kaç|kac|how many|toplam|total)\b", ql):
            return None

        # First: if there's an explicit TOTAL INVERTERS row, use it directly (best signal).
        for r in items:
            text = (r.get("text") or "")
            meta = r.get("metadata") or {}
            doc_name = meta.get("doc_name") or "Unknown Document"
            table_num = meta.get("table_num")
            sheet = meta.get("sheet")
            page = meta.get("page")
            loc = None
            if table_num is not None:
                loc = f"Table: {table_num}"
            elif sheet:
                loc = f"Sheet: {sheet}"
            elif page:
                loc = f"Page: {page}"
            cit = f"[Kaynak: {doc_name}{', ' + loc if loc else ''}]"

            kvs = _extract_kv_pairs_from_data(text)
            if not kvs:
                continue

            # Some rows encode this as two pairs with the same key:
            #   Key: "TOTAL Nº INVERTERS" (as a value), then Key: "154" (as a value).
            has_total_label = any(("total" in (k.lower())) and ("inverter" in (k.lower())) for k, _ in kvs) or any(
                ("total" in (v.lower())) and ("inverter" in (v.lower())) for _, v in kvs
            )
            if has_total_label:
                for _, v in kvs:
                    # accept simple integer totals
                    m = re.fullmatch(r"\s*(\d{1,6})\s*", v)
                    if m:
                        n = int(m.group(1))
                        return {"answer": f"Projede toplam {n} adet inverter bulunmaktadır {cit}", "source": doc_name}

        # Otherwise: collect per-substation inverter counts from structured DATA rows.
        per_sub: dict[str, list[tuple[int, str]]] = defaultdict(list)  # sub -> [(count, citation)]
        for r in items:
            text = r.get("text") or ""
            if "inverter" not in text.lower():
                continue
            meta = r.get("metadata") or {}
            doc_name = meta.get("doc_name") or "Unknown Document"
            table_num = meta.get("table_num")
            sheet = meta.get("sheet")
            page = meta.get("page")
            loc = None
            if table_num is not None:
                loc = f"Table: {table_num}"
            elif sheet:
                loc = f"Sheet: {sheet}"
            elif page:
                loc = f"Page: {page}"
            citation = f"[Kaynak: {doc_name}{', ' + loc if loc else ''}]"

            # Prefer parsing structured DATA
            for k, v in _extract_kv_pairs_from_data(text):
                # substation keys in docx look like "SUBSTATION 1"
                m = re.search(r"\bSUBSTATION\s*(\d+)\b", k, flags=re.IGNORECASE)
                if not m:
                    continue
                sub = f"Substation {m.group(1)}"
                v_lower = v.lower()
                if "inverter" not in v_lower:
                    continue
                n = re.search(r"\b(\d+)\b", v_lower)
                if not n:
                    continue
                # Ignore complex expressions (e.g. "13 inverters x 30 strings") to avoid ambiguous extraction
                if re.search(r"[x×*/+]", v_lower):
                    continue
                if len(v_lower) > 40:
                    continue
                per_sub[sub].append((int(n.group(1)), citation))

            # Fallback: match patterns like "Substation X: 22 inverters" (ignore complex expressions)
            for m in re.finditer(
                r"\bsubstation\s*(\d+)\b.*?\b(\d+)\b\s*inverters?\b",
                text,
                flags=re.IGNORECASE | re.DOTALL,
            ):
                seg = (m.group(0) or "").lower()
                if re.search(r"[x×*/+]", seg):
                    continue
                sub = f"Substation {m.group(1)}"
                per_sub[sub].append((int(m.group(2)), citation))

        # Deduplicate counts per substation/citation.
        dedup: dict[str, list[tuple[int, str]]] = {}
        for sub, vals in per_sub.items():
            seen = set()
            out = []
            for n, cit in vals:
                key = (n, cit)
                if key in seen:
                    continue
                seen.add(key)
                out.append((n, cit))
            dedup[sub] = out

        if len(dedup) < 2:
            return None

        # If each substation has exactly one value, we can compute a total.
        unambiguous = all(len(v) == 1 for v in dedup.values())

        lines = []
        # Provide breakdown always (safe and useful)
        for sub in sorted(dedup.keys(), key=lambda s: int(re.search(r"\d+", s).group(0))):
            vals = dedup[sub]
            if len(vals) == 1:
                n, cit = vals[0]
                lines.append(f"- {sub}: {n} inverter {cit}")
            else:
                # multiple numbers for same substation -> ambiguous; list them
                parts = ", ".join([f"{n} {cit}" for n, cit in vals])
                lines.append(f"- {sub}: {parts}")

        if unambiguous:
            total = sum(v[0][0] for v in dedup.values())
            calc = " + ".join(
                str(v[0][0]) for _, v in sorted(dedup.items(), key=lambda kv: int(re.search(r"\d+", kv[0]).group(0)))
            )
            lines.append(f"Toplam inverter sayısı: {total} (hesap: {calc})")
        else:
            lines.append(
                "Not: Aynı substation için birden fazla inverter sayısı geçtiği için tek bir toplam değeri güvenle hesaplayamıyorum."
            )

        answer = "\n".join(lines)
        # Provide a source summary for UI
        source = ", ".join(
            sorted({(r.get("metadata") or {}).get("doc_name") for r in items if (r.get("metadata") or {}).get("doc_name")})
        ) or None
        return {"answer": answer, "source": source}

    # Use all relevant results for aggregation to maximize recall (selected_results may miss the TOTAL row).
    agg = _try_answer_total_inverters(question, relevant_results)
    if agg:
        return agg

    # Extra safety for definition questions removed to allow "Intelligent Analyst" prompt to handle it.
    # The strict Python-level check was too aggressive for acronyms and table data.
    pass

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

    # Normalize fallback to the canonical message to avoid LLM paraphrasing breaking strict checks/UI.
    ans_l = (answer or "").strip().lower()
    if re.search(r"\b(cannot find|can't find|could not find|bulamıyorum|bulamadım|bulunamıyor)\b", ans_l):
        answer = fallback
    
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

    # If the model cited a specific document, align the API-level `source` to that document name.
    # This prevents confusing UI mismatches like "answer cites docx but source shows xlsx".
    m_cite = re.search(r"\[(?:Source|Kaynak):\s*([^,\]\n]+)", answer or "", flags=re.IGNORECASE)
    if m_cite:
        cited_doc = m_cite.group(1).strip()
        if cited_doc and cited_doc not in source:
            source = cited_doc

    # Source consistency for fallback answers:
    # - If the model says "cannot find", return a source list of the docs we searched (top-N),
    #   instead of a single possibly-wrong primary source.
    fb_tr = (get_fallback_message("tr") or "").strip().lower()
    fb_en = (get_fallback_message("en") or "").strip().lower()
    ans_l = (answer or "").strip().lower()
    is_fallback = (fb_tr and ans_l.startswith(fb_tr)) or (fb_en and ans_l.startswith(fb_en))

    if is_fallback:
        doc_names = []
        for r in (selected_results or [])[:5]:
            dn = (r.get("metadata") or {}).get("doc_name")
            if dn and dn not in doc_names:
                doc_names.append(dn)
        source_list = ", ".join(doc_names) if doc_names else None
        if source_list and not re.search(r"\[(Source|Kaynak):", answer, flags=re.IGNORECASE):
            answer = f"{answer.rstrip()} [Kaynak: {source_list}]"
        return {"answer": answer, "source": source_list}

    # Enforce citation format: if model forgot, append a citation to the primary source.
    if answer and not re.search(r"\[(Source|Kaynak):", answer, flags=re.IGNORECASE):
        answer = f"{answer.rstrip()} [Kaynak: {source}]"

    return {"answer": answer, "source": source}
