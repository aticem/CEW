# CEW AI ASSISTANT – VERTICAL RAG PROJECT RULES (SYSTEM CONSTITUTION)

This file defines the non-negotiable rules for the AI Agent
(Cline / Copilot Agent) working on the CEW AI Assistant.

The agent MUST read and strictly follow all rules below.

---

## 1. PROJECT PURPOSE

Build a document-grounded AI Assistant for solar farm projects,
allowing users to ask technical questions based ONLY on uploaded
project documents.

Goals:
- Working MVP, fast
- No over-engineering
- Safety and correctness over completeness

---

## 2. ALLOWED KNOWLEDGE (CRITICAL)

The AI Assistant may ONLY use:

- Technical specifications (PDF)
- Installation manuals (PDF)
- QA / QC documents (ITP, checklists, NCR)
- Excel BOM / BOQ files
- Legend & symbol explanation pages
- CEW system data (read-only, summary only)

❌ No external knowledge  
❌ No standards unless uploaded  
❌ No guessing  
❌ No assumptions  

If information is not found, the AI MUST say:
"This information was not found in the uploaded documents."

---

## 3. TECHNOLOGY STACK (MANDATORY)

Backend:
- Python 3.11+
- FastAPI (async)

Frontend:
- Existing CEW React / Vite app
- AI Assistant as a separate UI module

Data:
- Metadata DB: Supabase (PostgreSQL)
- Vector DB: Pinecone
- Local dev: ChromaDB allowed

LLM:
- Anthropic Claude 3.5 Sonnet

❌ Forbidden:
- LangChain
- LlamaIndex
- Magic abstractions

---

## 4. ARCHITECTURE RULES

- AI service MUST be separate from CEW UI logic
- Ingestion and Query MUST be separate steps
- Documents are indexed ONCE
- No re-indexing per query

---

## 5. AGENT BEHAVIOUR RULES

- Files must be fully written
- No TODOs
- No partial functions
- No placeholders
- Choose the simplest working solution
- If unsure, STOP and ask in chat

---

## 6. MVP SCOPE (STRICT)

IN SCOPE:
- PDF (text-based only)
- Excel BOM / BOQ
- Source-based answers

OUT OF SCOPE:
- OCR
- DWG parsing
- Drawing measurement inference
- Authentication
- Billing
- UI polish

---

## 7. INITIAL TASK

1. Create `ai-service/` folder
2. Setup Python virtual environment
3. Create minimal FastAPI app
4. Create ingestion skeleton
5. Create query skeleton
6. App must start without errors

---

## 8. PRINCIPLE

The AI Assistant does not "know".
It only retrieves and explains existing project information.
