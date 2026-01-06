# CEW AI ASSISTANT – PRODUCTION ARCHITECTURE

**Version:** 1.0  
**Date:** 2026-01-06  
**Status:** Production-Grade Design

---

## 1. SYSTEM OVERVIEW

The CEW AI Assistant is a **Vertical RAG (Retrieval-Augmented Generation)** system that provides construction engineers with accurate, source-backed answers from project documentation and production data.

### Core Principles
- **Source-Constrained**: Only answers from indexed documents and CEW database
- **Zero Hallucination**: No guessing, no general knowledge, no inference
- **Full Traceability**: Every answer includes document source references
- **Security-First**: LLM API keys never exposed to frontend
- **Production-Ready**: Built for real construction sites, not demos

---

## 2. HIGH-LEVEL ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│                         GOOGLE DRIVE                             │
│                    (Source of Truth)                             │
│  CEW_AI/                                                         │
│  ├─ Specifications/                                              │
│  ├─ Manuals/                                                     │
│  ├─ QAQC/                                                        │
│  ├─ BOM_BOQ/                                                     │
│  ├─ Drawings/                                                    │
│  └─ Legends/                                                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ (1) Manual Ingest Trigger
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AI BACKEND SERVICE                            │
│                   (Node.js / Python)                             │
│                   Port: 3001                                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              INGEST PIPELINE                              │  │
│  │  • Google Drive API Client                                │  │
│  │  • Document Parser (PDF/Excel/Word)                       │  │
│  │  • Chunking Engine                                        │  │
│  │  • Embedding Generator (OpenAI/Cohere)                    │  │
│  │  • Metadata Extractor                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         │                                        │
│                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              VECTOR DATABASE                              │  │
│  │  • Pinecone / Qdrant / Weaviate                           │  │
│  │  • Document chunks + embeddings                           │  │
│  │  • Metadata: doc_name, page, section, folder, date       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              QUERY PIPELINE                               │  │
│  │  1. Query Agent (Classification)                          │  │
│  │  2. Retrieval Engine (Vector Search)                      │  │
│  │  3. Guard Agent (Pre-validation)                          │  │
│  │  4. LLM Response Generator (OpenAI/Anthropic)             │  │
│  │  5. Post-Answer Guard (Validation)                        │  │
│  │  6. Source Formatter                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         │                                        │
│                         │ (2) Read-Only Access                   │
│                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         CEW DATABASE CONNECTOR                            │  │
│  │  • Read-only SQL queries                                  │  │
│  │  • Progress data, QA/QC records                           │  │
│  │  • Testing results, inspection data                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              REST API ENDPOINTS                           │  │
│  │  POST /api/query          - User question                 │  │
│  │  POST /api/ingest/trigger - Manual ingest                 │  │
│  │  GET  /api/ingest/status  - Ingest progress               │  │
│  │  GET  /health             - Service health                │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ (3) HTTPS/JSON
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CEW FRONTEND (React)                          │
│                    Port: 5173 (dev) / 80 (prod)                 │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         AI ASSISTANT MODULE                               │  │
│  │  • Chat UI (messages, input, sources)                     │  │
│  │  • Service health check                                   │  │
│  │  • Question submission                                    │  │
│  │  • Source display                                         │  │
│  │  • NO LLM API keys                                        │  │
│  │  • NO direct vector DB access                             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Other Modules:                                                 │
│  • DC/AC Trench Progress                                        │
│  • Cable Testing                                                │
│  • QA/QC Management                                             │
│  • etc.                                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. SERVICE BOUNDARIES

### 3.1 CEW Frontend (React)
**Responsibility:**
- User interface for AI Assistant module
- Display chat messages and sources
- Submit questions to backend
- Show service health status

**Does NOT:**
- Store LLM API keys
- Access vector database directly
- Parse documents
- Generate embeddings
- Call LLM APIs

**Technology:**
- React 19
- Vite
- Fetch API for backend communication

**Security:**
- No sensitive credentials
- CORS-protected API calls
- Read-only interaction with backend

---

### 3.2 AI Backend Service
**Responsibility:**
- Document ingestion from Google Drive
- PDF/Excel/Word parsing
- Text chunking and embedding generation
- Vector database management
- Query classification and routing
- LLM orchestration
- Guard agent validation
- Source citation formatting
- CEW database read-only queries

**Does NOT:**
- Modify Google Drive documents
- Write to CEW production database
- Expose LLM API keys to frontend
- Store user credentials

**Technology Stack:**
- **Runtime:** Node.js 20+ (or Python 3.11+)
- **Framework:** Express.js (or FastAPI)
- **Document Parsing:**
  - `pdf-parse` or `PyPDF2` (PDF text extraction)
  - `exceljs` or `openpyxl` (Excel parsing)
  - `mammoth` or `python-docx` (Word parsing)
- **Embeddings:** OpenAI API, Cohere, or local models
- **LLM:** OpenAI GPT-4, Anthropic Claude, or Azure OpenAI
- **Vector DB Client:** Pinecone SDK, Qdrant client, or Weaviate client
- **Google Drive:** `googleapis` (Node.js) or `google-api-python-client`

**Security:**
- Environment variables for API keys
- Service account for Google Drive access
- Read-only database connection string
- Rate limiting on API endpoints
- Input validation and sanitization

---

### 3.3 Vector Database
**Responsibility:**
- Store document chunks as embeddings
- Perform semantic similarity search
- Return relevant chunks with metadata

**Options:**
- **Pinecone** (managed, production-ready)
- **Qdrant** (self-hosted or cloud)
- **Weaviate** (self-hosted or cloud)
- **Chroma** (lightweight, local dev)

**Data Schema:**
```json
{
  "id": "doc_123_chunk_5",
  "embedding": [0.123, -0.456, ...],
  "metadata": {
    "doc_name": "277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf",
    "doc_type": "PDF_DRAWING",
    "folder": "QAQC/Checklists/electrical/dc-cable",
    "page": 5,
    "section": "Section 3.2 - Trench Specifications",
    "updated_at": "2026-01-05T10:30:00Z",
    "chunk_text": "Trench depth shall be minimum 800mm..."
  }
}
```

---

### 3.4 Google Drive
**Responsibility:**
- Store all project documents (source of truth)
- Provide API access for document retrieval

**Structure:**
```
CEW_AI/
├─ Specifications/
├─ Manuals/
├─ QAQC/
│  ├─ Checklists/
│  ├─ ITPs/
│  ├─ NCRs/
│  └─ ThirdParty/
├─ BOM_BOQ/
├─ Drawings/
└─ Legends/
```

**Access:**
- Service account with read-only permissions
- OAuth 2.0 authentication
- Scoped to `CEW_AI/` folder only

---

### 3.5 CEW Database
**Responsibility:**
- Store production progress data
- QA/QC records, testing results
- Provide read-only access to AI service

**Access Pattern:**
- Read-only connection string
- Parameterized queries only
- No direct table modifications
- Query timeout limits

**Example Queries:**
- "What is the DC cable testing progress for Inverter 42?"
- "Show me the latest QA/QC inspection results for LV termination"

---

## 4. DATA FLOW

### 4.1 INGEST FLOW (One-Time / Manual Trigger)

```
[Engineer] → "Trigger Ingest"
    ↓
[Frontend] → POST /api/ingest/trigger
    ↓
[AI Backend - Ingest Pipeline]
    ↓
1. List files from Google Drive (CEW_AI/ folder)
    ↓
2. For each file:
   - Identify type (PDF_TEXT, PDF_DRAWING, EXCEL_BOM, SCANNED_PDF)
   - Parse content (extract text, tables, metadata)
   - Chunk content (semantic chunks with overlap)
   - Generate embeddings (OpenAI/Cohere)
   - Extract metadata (doc_name, page, section, folder, date)
    ↓
3. Upsert to Vector Database
   - Store embedding + metadata
   - Update existing chunks if document changed
    ↓
4. Return status
    ↓
[Frontend] ← "Ingest complete: 247 documents, 3,421 chunks"
```

**Key Points:**
- Manual trigger (not automatic)
- Idempotent (can re-run safely)
- Progress tracking
- Error handling for unsupported formats

---

### 4.2 QUERY FLOW (Runtime)

```
[Engineer] → "What is the minimum trench depth for DC cables?"
    ↓
[Frontend] → POST /api/query { question: "..." }
    ↓
[AI Backend - Query Pipeline]
    ↓
1. Query Agent: Classify question
   → Category: "Technical Value"
   → Domain: "Electrical / DC Cable"
    ↓
2. Retrieval Engine: Vector search
   → Query embedding generated
   → Top 5-10 relevant chunks retrieved
   → Metadata included (doc_name, page, section)
    ↓
3. Guard Agent (Pre-validation):
   → Are chunks relevant?
   → Is information explicit (not requiring inference)?
   → Is source traceable?
   → Decision: PASS / BLOCK
    ↓
   [If BLOCK] → Return fallback response
   [If PASS] → Continue
    ↓
4. LLM Response Generator:
   → Prompt: System rules + retrieved chunks + question
   → LLM generates answer
   → Answer format: concise, technical, source-backed
    ↓
5. Post-Answer Guard:
   → Validate source is present
   → Check for forbidden language
   → Ensure no compliance claims
   → Decision: PASS / BLOCK
    ↓
   [If BLOCK] → Return fallback response
   [If PASS] → Continue
    ↓
6. Source Formatter:
   → Extract sources from chunks
   → Format: "doc_name (page X, section Y)"
    ↓
[Frontend] ← {
  success: true,
  answer: "Minimum trench depth is 800mm...",
  sources: [
    { docName: "277-007-D-C-40327 Rev 03", page: 5, section: "3.2" }
  ]
}
    ↓
[Engineer] sees answer + sources in chat UI
```

**Key Points:**
- Guard agents prevent hallucination
- Fallback response if no valid answer
- Sources always included
- LLM never exposed to frontend

---

### 4.3 CEW DATABASE QUERY FLOW

```
[Engineer] → "What is the DC cable testing progress for Inverter 42?"
    ↓
[Frontend] → POST /api/query { question: "..." }
    ↓
[AI Backend - Query Pipeline]
    ↓
1. Query Agent: Classify question
   → Category: "CEW System Data"
   → Domain: "DC Cable Testing"
    ↓
2. Database Connector:
   → Generate SQL query (read-only)
   → Execute with timeout
   → Return structured data
    ↓
3. LLM Response Generator:
   → Format data into natural language
   → Include table/record references
    ↓
[Frontend] ← {
  success: true,
  answer: "Inverter 42 DC cable testing: 18/24 strings completed...",
  sources: [
    { docName: "CEW Database", table: "dc_cable_testing", record: "INV-42" }
  ]
}
```

---

## 5. SECURITY & COMPLIANCE

### 5.1 API Key Management
- **LLM API Keys:** Stored in backend environment variables only
- **Google Drive Service Account:** JSON key file, not in version control
- **Vector DB API Key:** Backend environment variables
- **CEW Database:** Read-only connection string, backend only

### 5.2 Access Control
- Frontend has NO direct access to:
  - LLM APIs
  - Vector database
  - Google Drive
  - CEW database (write operations)
- All sensitive operations go through backend API

### 5.3 Data Privacy
- No user questions stored permanently (optional: audit log)
- No document content sent to frontend (only answers)
- No PII in vector database metadata

### 5.4 Rate Limiting
- API endpoints rate-limited per IP
- LLM call throttling to prevent abuse
- Ingest pipeline concurrency limits

---

## 6. DEPLOYMENT ARCHITECTURE

### 6.1 Development Environment
```
[Local Machine]
├─ CEW Frontend: http://localhost:5173 (Vite dev server)
├─ AI Backend: http://localhost:3001 (Node.js/Express)
└─ Vector DB: Cloud-hosted (Pinecone) or local (Qdrant)
```

### 6.2 Production Environment
```
[Cloud Infrastructure]
├─ CEW Frontend: https://cew.example.com (Nginx + React build)
├─ AI Backend: https://api-ai.cew.example.com (PM2/Docker + Node.js)
├─ Vector DB: Pinecone Cloud / Qdrant Cloud
├─ CEW Database: PostgreSQL (read-only replica for AI)
└─ Google Drive: Service account access
```

**Recommendations:**
- **Frontend:** Vercel, Netlify, or AWS S3 + CloudFront
- **Backend:** AWS EC2, Google Cloud Run, or DigitalOcean Droplet
- **Vector DB:** Pinecone (managed) or self-hosted Qdrant on Kubernetes
- **Monitoring:** Sentry (errors), Datadog (metrics), CloudWatch (logs)

---

## 7. TECHNOLOGY STACK SUMMARY

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | React 19 + Vite | UI for AI Assistant module |
| **Backend** | Node.js 20 + Express | API server, orchestration |
| **Document Parsing** | pdf-parse, exceljs, mammoth | Extract text from files |
| **Embeddings** | OpenAI API (text-embedding-3-small) | Convert text to vectors |
| **LLM** | OpenAI GPT-4 or Anthropic Claude | Generate answers |
| **Vector DB** | Pinecone / Qdrant | Store and search embeddings |
| **Google Drive** | googleapis (Node.js SDK) | Fetch documents |
| **CEW Database** | PostgreSQL (read-only) | Production data queries |
| **Deployment** | Docker + PM2 / Cloud Run | Production hosting |

---

## 8. MVP SCOPE (Phase 1)

### Included:
✅ Manual ingest trigger  
✅ PDF text extraction (PDF_TEXT)  
✅ Excel BOM parsing (EXCEL_BOM)  
✅ Vector search and retrieval  
✅ Guard agents (pre/post validation)  
✅ Source citation  
✅ CEW database read-only queries  
✅ Chat UI in CEW frontend  

### Excluded (Future Phases):
❌ OCR for scanned PDFs  
❌ DWG/CAD file parsing  
❌ Automatic ingest (webhook-based)  
❌ Multi-project support  
❌ Advanced drawing interpretation  
❌ User authentication (assumes CEW handles auth)  

---

## 9. SCALABILITY CONSIDERATIONS

### 9.1 Document Volume
- **Current:** ~500 documents, ~5,000 chunks
- **Future:** 5,000+ documents, 50,000+ chunks
- **Solution:** Pinecone scales automatically, Qdrant can be clustered

### 9.2 Query Load
- **Current:** 10-50 queries/day
- **Future:** 500+ queries/day
- **Solution:** Backend horizontal scaling (multiple instances behind load balancer)

### 9.3 Ingest Performance
- **Current:** Manual trigger, ~5-10 minutes for full ingest
- **Future:** Incremental updates, parallel processing
- **Solution:** Queue-based ingest (Bull/BullMQ), worker processes

---

## 10. MONITORING & OBSERVABILITY

### Key Metrics:
- **Query latency:** Time from question to answer
- **Retrieval accuracy:** Relevance of retrieved chunks
- **Guard block rate:** % of queries blocked by guards
- **LLM token usage:** Cost tracking
- **Ingest success rate:** % of documents successfully indexed
- **Service uptime:** Backend availability

### Logging:
- All queries logged (question, answer, sources, latency)
- Ingest pipeline logs (files processed, errors)
- Guard decisions logged (why blocked)

### Alerts:
- Backend service down
- LLM API errors
- Vector DB connection failures
- High guard block rate (indicates poor retrieval)

---

## 11. NEXT STEPS

1. **Set up AI Backend Service** (Node.js + Express)
2. **Implement Ingest Pipeline** (Google Drive → Vector DB)
3. **Implement Query Pipeline** (Question → Answer + Sources)
4. **Integrate with CEW Frontend** (API calls from AIAssistantModule)
5. **Deploy to Production** (Docker + Cloud hosting)
6. **Test with Real Documents** (QAQC, BOMs, Specifications)
7. **Monitor and Iterate** (Improve retrieval, guard logic)

---

**End of Architecture Document**
