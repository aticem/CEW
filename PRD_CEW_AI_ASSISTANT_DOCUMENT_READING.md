# **PRODUCT REQUIREMENTS DOCUMENT (PRD)**
## **CEW AI Assistant – Document Reading System**

**Version:** 1.0  
**Date:** January 10, 2026  
**Status:** Draft for Approval  
**Author:** CEW Development Team  

---

## **EXECUTIVE SUMMARY**

The CEW AI Assistant – Document Reading System is a Retrieval-Augmented Generation (RAG) system designed to provide construction engineers with accurate, source-backed answers from project documentation. The system operates on three core principles:

1. **Zero Hallucination**: No guessing, no inference, no general knowledge
2. **Full Traceability**: Every answer includes explicit document source references
3. **Controlled Accuracy**: Technical/numeric data requires near-100% accuracy; speculative answers are forbidden

**MVP Scope:** Local document ingestion (PDF, DOCX, Excel), semantic chunking, vector-based retrieval, LLM-powered Q&A with Claude Sonnet, and self-validation using predefined test questions.

---

## **1. SCOPE & OBJECTIVES**

### **1.1 In Scope (MVP)**

#### **Core Functionality**
- Local document ingestion from /ai-service/documents/
- Structured parsing for PDF (text-based), DOCX, and Excel formats
- Intelligent chunking based on semantic boundaries (sections, headings, tables)
- Vector database indexing with Qdrant
- Document-based question answering via Claude Sonnet
- Explicit source referencing (doc name + page/section + chunk ID)
- Self-validation using predefined technical test questions
- Deterministic failure handling ("answer or explicitly say not found")

#### **Document Format Support**

| Format | Support Level | Details |
|--------|--------------|---------|
| **PDF (text-based)** | Full Support | Section-level and table-level extraction |
| **DOCX** | Full Support | Headings, paragraphs, tables preserved |
| **Excel (XLSX/XLS)** | Full Support | Multi-sheet support, table-aware parsing |

#### **Technical Constraints**
- No OCR (scanned PDFs excluded)
- No image understanding or layout-perfect reconstruction
- Formatting preserved only for correct technical interpretation and reliable table extraction

### **1.2 Out of Scope (Future Iterations)**

- Google Drive or external storage integration
- Batch ingestion pipelines with automatic triggers
- Real-time document updates (webhook-based)
- Multi-user permissions and role-based access control (RBAC)
- Advanced UI features (filters, highlights, deep linking)
- Analytics dashboards
- Additional document formats (PPT, TXT, CSV, MD)
- OCR for scanned documents
- DWG/CAD file parsing

---

## **2. REQUIREMENTS**

### **2.1 Functional Requirements**

#### **FR-1: Document Parsing**

- FR-1.1: The system MUST extract text content from PDF, DOCX, and Excel files
- FR-1.2: The system MUST preserve section headings, paragraphs, and table structures
- FR-1.3: The system MUST extract multi-sheet Excel data with table-aware parsing
- FR-1.4: The system MUST reject or flag documents that cannot be parsed reliably
- FR-1.5: The system MUST NOT attempt OCR or image interpretation

#### **FR-2: Chunking Strategy**

- FR-2.1: The system MUST implement hybrid chunking:
  - Primary: Semantic chunking based on document structure (sections, headings, tables as atomic units)
  - Fallback: Fixed-size chunks with minimal overlap when semantic boundaries cannot be determined
- FR-2.2: For Word/PDF documents, chunks MUST be based on section and table boundaries
- FR-2.3: For Excel documents, chunks MUST be at sheet-level and table-level (no row-by-row splitting unless necessary)
- FR-2.4: Each chunk MUST preserve context continuity with minimal overlap
- FR-2.5: Chunk size MUST be determined by semantic boundaries, not token count

#### **FR-3: Source Referencing**

- FR-3.1: Every answer MUST include: Document name, Section/heading title, Page number (PDF/Word) or sheet name (Excel), Internal chunk ID
- FR-3.2: Source references MUST be explicit and verifiable
- FR-3.3: Confidence scores MUST NOT be shown to users
- FR-3.4: Clickable links to documents are optional for MVP

#### **FR-4: Query Processing**

- FR-4.1: The system MUST process natural language queries
- FR-4.2: The system MUST retrieve relevant document chunks using vector similarity search
- FR-4.3: The system MUST generate answers using Claude Sonnet (or Claude Opus for deeper reasoning)
- FR-4.4: The system MUST respond within 3 seconds for typical queries
- FR-4.5: If no relevant information is found, the system MUST respond: "The requested information was not found in the available project documents."

#### **FR-5: Failure Handling**

**Ingestion Phase:**
- FR-5.1: Partial ingestion is allowed: successfully parsed sections/tables are ingested; failed elements are logged
- FR-5.2: Automatic retry with fallback strategies (alternative parsers, simpler extraction) is permitted
- FR-5.3: If critical structural elements cannot be parsed, the document MUST be flagged as "partially ingested"

**Query Phase:**
- FR-5.4: The system MUST NEVER guess or infer missing information
- FR-5.5: If required data is unavailable or unreliable, the system MUST explicitly state: "The requested information was not found in the available project documents."
- FR-5.6: The system MUST degrade gracefully without crashes or misleading answers

### **2.2 Non-Functional Requirements**

#### **NFR-1: Accuracy**

- NFR-1.1: For technical, numeric, and compliance-related data: Near-100% accuracy is required
- NFR-1.2: The system MUST NOT guess uncertain data; it MUST explicitly refuse to answer
- NFR-1.3: For general descriptive text: Slight paraphrasing is acceptable, but meaning MUST remain faithful
- NFR-1.4: The system MUST NEVER present speculative or inferred values as factual answers

#### **NFR-2: Performance**

- NFR-2.1: Query response time: Under 3 seconds for typical document queries
- NFR-2.2: Document ingestion time: Up to 30 seconds per document is acceptable
- NFR-2.3: The system MUST support at least 100+ documents without performance degradation
- NFR-2.4: Correctness and reliability MUST take priority over speed

#### **NFR-3: Security**

- NFR-3.1: The AI backend (ai-service) MUST NOT be publicly exposed
- NFR-3.2: Access MUST be restricted to the CEW1 application via API key authentication
- NFR-3.3: API keys MUST be stored securely in environment variables
- NFR-3.4: The system MUST have read-only access to documents and CEW data
- NFR-3.5: No document modification or deletion by the AI is allowed

#### **NFR-4: Scalability**

- NFR-4.1: The system MUST handle 100+ documents and 1,000+ chunks for MVP
- NFR-4.2: The architecture MUST support future expansion to 5,000+ documents

---

## **3. ARCHITECTURE**

### **3.1 Technology Stack**

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | React 19 + Vite | AI Assistant UI module |
| Backend | Node.js 20 + Express | API server, orchestration |
| Document Parsing | pdf-parse, mammoth, exceljs | Extract text from files |
| Embeddings | OpenAI API (text-embedding-3-small) | Convert text to vectors |
| LLM | Anthropic Claude Sonnet | Generate answers (reasoning engine) |
| Vector DB | Qdrant (Docker/Cloud) | Store and search embeddings |
| Deployment | Docker + PM2 | Production hosting |

### **3.2 LLM Configuration**

- **Primary Model:** Claude Sonnet (default for MVP)
- **Optional Model:** Claude Opus (for deeper reasoning or larger context)
- **Rationale:** Strong reliability, large context window, low hallucination tendency
- **Usage:** LLM is used strictly as a reasoning engine with no direct file access

---

## **4. DATA FLOW**

### **4.1 Document Ingestion Flow**

1. Engineer triggers ingest manually
2. Frontend sends POST /api/ingest/trigger
3. AI Backend - Ingest Pipeline:
   - List files from /ai-service/documents/
   - Identify file types (PDF, DOCX, Excel)
   - For each file: Parse content, detect semantic boundaries, chunk content, generate embeddings, extract metadata
   - Upsert chunks to Qdrant Vector Database
   - Log ingestion results
4. Frontend receives: "Ingest complete: 50 documents, 723 chunks"

**Key Characteristics:**
- Manual trigger (not automatic) for MVP
- Idempotent (can re-run safely)
- Partial ingestion allowed with error logging
- Progress tracking available via /api/ingest/status

### **4.2 Query Processing Flow**

1. Engineer asks: "What is the minimum trench depth for DC cables?"
2. Frontend sends POST /api/query { question: "..." }
3. AI Backend - Query Pipeline:
   - Generate query embedding
   - Vector similarity search (top 5-10 chunks, threshold 0.7)
   - Build context from retrieved chunks
   - Generate LLM prompt (system rules + context + question)
   - Call Claude Sonnet API (temperature: 0.1, max tokens: 1000)
   - Validate response (no guessing, sources present)
   - Format sources
4. Frontend receives answer with sources

**Key Characteristics:**
- Sub-3-second response time target
- Explicit "not found" response if no relevant data
- Full source traceability for every answer
- No speculative or inferred answers

---

## **5. API DESIGN**

### **5.1 Endpoints**

#### **POST /api/query**
Submit a question to the AI Assistant.

Request: { "question": "What is the minimum trench depth for DC cables?" }

Response (Success):
{
  "success": true,
  "answer": "The minimum trench depth for DC cables is 800mm as specified in Section 3.2.",
  "sources": [{ "docName": "Technical_Spec_Rev01.pdf", "docType": "PDF", "page": 5, "section": "3.2 - Trench Specifications" }],
  "metadata": { "chunksRetrieved": 3, "tokensUsed": 487, "durationMs": 1823 }
}

Response (Not Found):
{
  "success": true,
  "answer": "The requested information was not found in the available project documents.",
  "sources": [],
  "metadata": { "chunksRetrieved": 0, "durationMs": 342 }
}

#### **POST /api/ingest/trigger**
Manually trigger document ingestion.

#### **GET /api/ingest/status**
Get current ingestion status.

#### **GET /health**
Check service health.

---

## **6. FOLDER STRUCTURE**

CEW/
├── ai-service/                      # AI Backend Service
│   ├── documents/                   # Local document storage (MVP)
│   ├── src/
│   │   ├── api/routes/              # REST API routes
│   │   ├── ingest/parsers/          # PDF/Word/Excel parsers
│   │   ├── ingest/chunking/         # Semantic text/Excel chunking
│   │   ├── ingest/embeddings/       # Embedding generation
│   │   ├── query/llm/               # Claude API integration
│   │   ├── vector/providers/        # Qdrant provider
│   │   ├── prompts/system/          # System prompts
│   │   └── config/                  # Environment config
│   ├── tests/validation/            # Validation tests
│   ├── .env                         # Environment variables
│   └── package.json
├── CEW1/_root/src/components/       # Frontend (AIAssistant.jsx)
└── docker-compose.yml               # Qdrant + services

---

## **7. TESTING & VALIDATION**

### **7.1 Self-Validation Strategy**

The system MUST use self-validation based on predefined technical questions with known ground truth.

**Validation Workflow:**
1. Create Test Questions File (tests/validation/testQuestions.json)
2. Run Validation Script (npm run validate)
3. Generate Validation Report (VALIDATION_REPORT.md)
4. Pass Criteria: 100% pass rate, no hallucinations, correct source references

### **7.2 Test Categories**

1. Technical Specifications - Numeric values, measurements, standards
2. BOM/BOQ Queries - Item counts, quantities, part numbers
3. Section References - Procedural steps, instructions
4. Table Data - Multi-row/column information extraction
5. Negative Cases - Questions with no answer in documents (must refuse)

---

## **8. SUCCESS CRITERIA**

### **8.1 MVP Launch Criteria**

**Functional Completeness:**
- [ ] Documents can be ingested from /ai-service/documents/
- [ ] PDF, DOCX, and Excel files are parsed correctly
- [ ] Chunks are created using semantic boundaries
- [ ] Vector database (Qdrant) is operational
- [ ] Query API returns answers with sources
- [ ] "Not found" response works correctly for missing information

**Accuracy Requirements:**
- [ ] 100% of validation test questions pass
- [ ] No hallucinations detected
- [ ] All answers include correct source references

**Performance Requirements:**
- [ ] Query response time < 3 seconds (average)
- [ ] Document ingestion completes within 30 seconds per document
- [ ] System handles 100+ documents without errors

**Security Requirements:**
- [ ] API key authentication enabled
- [ ] LLM API keys stored in environment variables only
- [ ] Frontend has no direct access to vector database or LLM

### **8.2 Key Performance Indicators (KPIs)**

| Metric | Target | Measurement |
|--------|--------|-------------|
| Query Accuracy | 100% (validation set) | Pass rate of test questions |
| Response Time | < 3 seconds | Average query latency |
| Document Coverage | 100+ documents | Total indexed documents |
| Uptime | > 99% | Service availability |
| Error Rate | < 5% | Failed queries / total queries |

---

## **9. ASSUMPTIONS & CONSTRAINTS**

### **9.1 Assumptions**

1. Documents in /ai-service/documents/ are text-extractable (not scanned)
2. Engineers will manually trigger ingest after adding/updating documents
3. CEW1 frontend handles user authentication (no auth in AI service for MVP)
4. Network connectivity to Anthropic API is reliable
5. Qdrant vector database is available (local Docker or cloud instance)

### **9.2 Constraints**

1. No OCR: Scanned PDFs are explicitly out of scope
2. No Real-Time Updates: Documents must be manually re-ingested
3. Single Project: Multi-project support deferred to future
4. Local Storage Only: Google Drive integration deferred to future
5. API Rate Limits: Subject to Anthropic Claude API rate limits

---

## **10. RISKS & MITIGATION**

| Risk | Impact | Likelihood | Mitigation Strategy |
|------|--------|-----------|---------------------|
| LLM Hallucination | High | Medium | System prompt enforcement, validation testing, explicit refusal behavior |
| Poor Retrieval Quality | High | Medium | Semantic chunking, tunable score thresholds, manual review |
| API Rate Limits | Medium | Low | Rate limiting on backend, caching, queue system |
| Parsing Failures | Medium | Medium | Partial ingestion, fallback parsers, error logging |
| Slow Query Response | Low | Low | Vector search optimization, parallel processing |

---

## **11. FUTURE ENHANCEMENTS (POST-MVP)**

**Phase 2:** Google Drive integration, automatic ingest triggers, OCR
**Phase 3:** Multi-step reasoning, cross-document synthesis, query history
**Phase 4:** User authentication, RBAC, audit logging, multi-project support
**Phase 5:** Document highlighting, clickable source links, export to reports

---

## **12. APPROVAL & SIGN-OFF**

This PRD must be reviewed and approved before implementation begins.

| Name | Role | Status | Date | Comments |
|------|------|--------|------|----------|
| [Name] | Product Owner | Pending | | |
| [Name] | Tech Lead | Pending | | |
| [Name] | QA Lead | Pending | | |

---

## **APPENDIX A: GLOSSARY**

- **RAG:** Retrieval-Augmented Generation - AI technique combining document retrieval with LLM generation
- **Chunking:** Breaking documents into smaller, semantically meaningful segments
- **Embedding:** Vector representation of text for similarity search
- **Vector Database:** Database optimized for similarity search (e.g., Qdrant)
- **Hallucination:** LLM generating false or unsupported information
- **Source Constraint:** Limiting LLM answers to only retrieved document content
- **Semantic Boundary:** Natural division in text (section, heading, table)

---

## **APPENDIX B: REFERENCE DOCUMENTS**

1. CEW1/_root/docs/ai/ARCHITECTURE.md - System architecture design
2. CEW1/_root/docs/ai/INGEST_FLOW.md - Ingestion process details
3. ai-service/README.md - Current implementation README
4. SETUP_AI_ASSISTANT.md - Setup guide for developers

---

**END OF PRD**
