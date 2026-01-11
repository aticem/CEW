# AGENT SYSTEM RULES — CEW AI SERVICE (NON-NEGOTIABLE)

This document defines the immutable architectural rules for the CEW AI Assistant.
Any AI agent (Cline, Cursor, Copilot, etc.) MUST read and obey this file
before performing ANY task in this repository.

If there is a conflict between:
- conversation context
- agent assumptions
- previous code

THIS FILE ALWAYS WINS.

--------------------------------------------------
1. PROJECT BOUNDARIES
--------------------------------------------------

- This is a SINGLE monorepo.
- CEW1 = existing frontend application.
- AI backend exists ONLY under `/ai-service`.

❌ NEVER modify CEW1 frontend unless explicitly instructed.
❌ NEVER move AI backend files outside `/ai-service`.

--------------------------------------------------
2. CORE ARCHITECTURAL PRINCIPLES
--------------------------------------------------

### INGESTION (STRICT RULES)

INGESTION MUST BE:
- 100% LOCAL
- 100% DETERMINISTIC
- 100% OFFLINE

During ingestion, the system MUST:
- Read documents ONLY from `/ai-service/documents`
- Parse documents locally (PDF / DOCX / XLSX / TXT)
- Normalize content into structured JSON
- Chunk content by logical sections / tables
- Store chunks and metadata in the vector database

INGESTION MUST NEVER:
- Call any LLM
- Call any embedding API
- Call Anthropic or OpenAI
- Perform HTTP requests
- Depend on external services

If ingestion makes an external API call, it is considered a CRITICAL FAILURE.

--------------------------------------------------
3. EMBEDDINGS STRATEGY (MANDATORY)
--------------------------------------------------

- Embeddings are GENERATED AT QUERY TIME ONLY.
- No embeddings are generated during ingestion.

Vector database usage:
- Payload-first storage is allowed.
- Zero or placeholder vectors may be used temporarily.
- Vector similarity may be computed at application level.

This design choice is intentional to ensure:
- Deterministic ingestion
- Model-agnostic storage
- Enterprise safety

--------------------------------------------------
4. QUERY & AI USAGE
--------------------------------------------------

- LLMs are used ONLY during query / validation phase.
- The only allowed LLM provider is:
  → Anthropic (Claude Sonnet family)

LLM USAGE RULES:

- Anthropic (Claude Sonnet family) is the ONLY allowed LLM
  for answer generation and reasoning.

- OpenAI MAY be used ONLY for embedding generation.
  Embeddings are non-authoritative and do not generate facts.

- OpenAI MUST NOT be used for:
  - answer generation
  - reasoning
  - summarization
  - decision making

❌ Mixing providers is FORBIDDEN.

The AI Assistant MUST:
- Answer ONLY from retrieved document content and CEW data
- NEVER hallucinate
- NEVER guess
- Explicitly say when information is not found

--------------------------------------------------
5. VALIDATION (NON-OPTIONAL)
--------------------------------------------------

This system MUST include automated self-validation.

Rules:
- Manual validation is NOT acceptable.
- Validation must run via:
  `npm run validate`
- All predefined validation questions must be executed.
- Success = 100% PASS.
- Anything less than 100% PASS is FAILURE.

The system MUST NOT claim completion unless validation passes fully.

--------------------------------------------------
6. TECHNOLOGY CONSTRAINTS
--------------------------------------------------

- Node.js backend
- ES Modules (no CommonJS)
- Vector DB: Qdrant
- Environment variables loaded from `/ai-service/.env`

API Keys:
- ANTHROPIC_API_KEY is required (for LLM)
- OPENAI_API_KEY is required (for embeddings only)

--------------------------------------------------
7. FAILURE HANDLING
--------------------------------------------------

If a task fails:
- The agent MUST diagnose the root cause.
- The agent MUST fix the issue.
- The agent MUST retry.
- The agent MUST NOT silently stop.

If anything is unclear:
- The agent MUST ask the user before proceeding.

--------------------------------------------------
8. COMPLETION CRITERIA
--------------------------------------------------

A task is considered COMPLETE ONLY IF:
- AI service starts without crashing
- Ingestion completes with ZERO failed files
- Validation passes 100%
- No architectural rules are violated

--------------------------------------------------
9. RETRIEVAL & RAG QUALITY RULES
--------------------------------------------------

The AI Assistant MUST aim for best-in-class document understanding.

Approved techniques include:
- Section-aware chunking
- Hybrid retrieval (lexical + semantic)
- Reranking of candidates
- Query rewriting and synonym expansion
- Citation-first answering

These techniques are NOT optional optimizations.
They are required to reach ChatGPT-level quality.

Using these techniques does NOT violate CEW rules,
as long as:
- Documents remain the only source of truth
- No hallucination occurs
- Ingestion remains offline
--------------------------------------------------

If API keys are unavailable, agents MUST prioritize
ingestion, parsing, and chunk quality improvements.
Query-time intelligence may be deferred.



--------------------------------------------------
END OF RULES
--------------------------------------------------
