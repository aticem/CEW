# CEW AI ASSISTANT – PRODUCT ROADMAP

**Version:** 1.0  
**Date:** 2026-01-06  
**Purpose:** Define realistic phased rollout for production deployment

---

## OVERVIEW

This roadmap defines a three-phase approach to deploying the CEW AI Assistant:

1. **Phase 1: MVP (Internal Use)** - Validate core functionality with internal team
2. **Phase 2: Paid Pilot (Single Site)** - Deploy to one construction site, gather feedback
3. **Phase 3: Multi-Project Scaling** - Scale to multiple sites and projects

**Philosophy:**
- Start small, validate, then scale
- Each phase builds on previous learnings
- Conscious decisions about what NOT to build
- Production-grade from day one (no "demo" code)

---

## PHASE 1: MVP (INTERNAL USE)

**Timeline:** 6-8 weeks  
**Goal:** Validate core RAG functionality with internal team before site deployment  
**Users:** 5-10 internal engineers (office-based)

---

### WHAT IS BUILT

#### 1. Core Infrastructure
- ✅ **AI Backend Service** (Node.js + Express)
  - REST API endpoints: `/api/query`, `/api/ingest/trigger`, `/health`
  - Error handling and logging
  - Rate limiting (10 queries/minute)
  
- ✅ **Vector Database** (Pinecone or Qdrant)
  - Single index for all documents
  - Metadata schema implemented
  - Upsert and query operations

- ✅ **Google Drive Integration**
  - Service account setup
  - Read-only access to `CEW_AI/` folder
  - File listing and download

---

#### 2. Document Ingestion Pipeline
- ✅ **PDF Text Extraction** (pdf-parse)
  - Extract text from PDF_TEXT documents
  - Page-by-page extraction
  - Section heading detection (basic heuristics)
  
- ✅ **Excel Parsing** (exceljs)
  - Extract sheets, headers, rows
  - Format as natural language chunks
  
- ✅ **Word Parsing** (mammoth)
  - Extract text and paragraphs
  
- ✅ **Chunking Strategy**
  - Fixed-size chunking (500 tokens, 50 overlap)
  - Metadata extraction (doc_name, page, section)
  
- ✅ **Embedding Generation** (OpenAI text-embedding-3-small)
  - Batch processing (100 chunks per call)
  
- ✅ **Manual Ingest Trigger**
  - Admin can trigger ingest via API call
  - Progress tracking (files processed, chunks created)

---

#### 3. Query Pipeline
- ✅ **Query Classification** (keyword-based)
  - DOCUMENT vs. DATA routing
  - Simple keyword matching (no LLM classification)
  
- ✅ **Vector Search**
  - Top 10 chunks retrieved
  - Similarity threshold: 0.7
  - Chunk ranking and deduplication
  
- ✅ **Guard Agents**
  - Pre-generation guard (chunk validation)
  - Post-generation guard (source validation, forbidden language)
  
- ✅ **LLM Integration** (OpenAI GPT-4)
  - System prompt with strict rules
  - Temperature 0.0 (deterministic)
  - Max tokens 500 (concise answers)
  
- ✅ **Source Extraction**
  - Parse sources from LLM response
  - Match with chunk metadata
  - Format for frontend display

---

#### 4. Database Integration
- ✅ **CEW Database Connector** (PostgreSQL)
  - Read-only connection
  - Parameterized queries only
  
- ✅ **SQL Query Templates** (5 templates)
  - Total quantity by module
  - Subcontractor performance
  - QA/QC checklist status
  - NCR status
  - Daily submission summary
  
- ✅ **Template Selection Logic**
  - Extract entities from question (module name, category)
  - Select appropriate template
  - Execute parameterized query

---

#### 5. Frontend Integration
- ✅ **AI Assistant Module** (React)
  - Chat interface (messages, input, sources)
  - Service health check
  - Source display with Drive links
  - Disclaimer banner
  
- ✅ **CEW Integration**
  - Module added to CEW navigation
  - Uses existing CEW authentication
  - Consistent styling with CEW

---

#### 6. Guardrails & Safety
- ✅ **Input Sanitization**
  - Detect prompt injection patterns
  - Reject suspicious questions
  
- ✅ **Fallback Responses**
  - "Information not found" when no data
  - No guessing or general knowledge
  
- ✅ **Audit Logging**
  - All queries logged (question, answer, sources, timestamp)
  - Guard blocks logged
  
- ✅ **Legal Disclaimer**
  - Frontend banner: "Does NOT provide legal/compliance/safety advice"

---

### WHAT IS NOT BUILT (CONSCIOUS DECISIONS)

#### ❌ OCR for Scanned PDFs
- **Reason:** Adds complexity, most PDFs have selectable text
- **Workaround:** Flag scanned PDFs as "OCR_REQUIRED", skip in MVP
- **Future:** Phase 2 if needed

#### ❌ DWG/CAD File Parsing
- **Reason:** Complex, requires specialized libraries
- **Workaround:** Drawings with text legends are supported
- **Future:** Phase 3 if demand exists

#### ❌ Automatic Ingest (Webhook-Based)
- **Reason:** Manual trigger is simpler, easier to debug
- **Workaround:** Admin triggers ingest after document updates
- **Future:** Phase 2 with Google Drive webhooks

#### ❌ Multi-Project Support
- **Reason:** Single project is sufficient for MVP
- **Workaround:** All documents in one `CEW_AI/` folder
- **Future:** Phase 3 with project-specific indexes

#### ❌ User Authentication (AI-Specific)
- **Reason:** CEW already handles authentication
- **Workaround:** AI Assistant uses CEW's existing auth
- **Future:** Not needed

#### ❌ Advanced Query Classification (LLM-Based)
- **Reason:** Keyword-based classification is faster and cheaper
- **Workaround:** Simple keyword matching
- **Future:** Phase 2 if accuracy issues

#### ❌ Streaming LLM Responses
- **Reason:** Adds complexity, 3-6 second latency is acceptable
- **Workaround:** Show loading indicator
- **Future:** Phase 3 for better UX

#### ❌ Query Caching (Redis)
- **Reason:** Low query volume in MVP, not needed
- **Workaround:** Direct LLM calls
- **Future:** Phase 2 when query volume increases

#### ❌ Admin Dashboard (Metrics)
- **Reason:** Logs are sufficient for MVP
- **Workaround:** Query logs in backend
- **Future:** Phase 2 with dashboard

#### ❌ Multi-Language Support
- **Reason:** English-only for MVP
- **Workaround:** All documents and queries in English
- **Future:** Phase 3 if international projects

---

### SUCCESS CRITERIA (PHASE 1)

**Technical:**
- ✅ 100% source citation rate
- ✅ <10% guard block rate (false positives)
- ✅ <6 second average response time
- ✅ 0% compliance/safety claims
- ✅ 0% hallucination detected

**User Feedback:**
- ✅ 5/10 internal engineers use it weekly
- ✅ 80% of answers rated "helpful" or "very helpful"
- ✅ <5% of answers require correction

**Business:**
- ✅ Core functionality validated
- ✅ No legal/safety incidents
- ✅ Ready for site deployment

---

## PHASE 2: PAID PILOT (SINGLE SITE)

**Timeline:** 8-12 weeks  
**Goal:** Deploy to one construction site, gather real-world feedback, iterate  
**Users:** 20-50 site engineers (field-based)

---

### WHAT IS BUILT

#### 1. Production Hardening
- ✅ **Docker Deployment**
  - Containerized backend service
  - Docker Compose for local dev
  - Production-ready Dockerfile
  
- ✅ **Cloud Hosting**
  - Backend on AWS EC2 / Google Cloud Run
  - Vector DB on Pinecone Cloud / Qdrant Cloud
  - Frontend on Vercel / Netlify
  
- ✅ **Monitoring & Alerting**
  - Sentry for error tracking
  - CloudWatch / Datadog for metrics
  - Alerts for service downtime, high error rate
  
- ✅ **Backup & Recovery**
  - Vector DB backups (daily)
  - Query logs backed up to S3
  - Disaster recovery plan

---

#### 2. Enhanced Ingestion
- ✅ **Automatic Ingest** (Google Drive Webhooks)
  - Trigger ingest when documents added/updated
  - Incremental updates (only changed documents)
  
- ✅ **OCR for Scanned PDFs** (if needed)
  - Tesseract OCR integration
  - Flag scanned PDFs, process with OCR
  
- ✅ **Improved Section Detection**
  - Better heading detection (font size, bold)
  - Table of contents parsing

---

#### 3. Advanced Query Features
- ✅ **LLM-Based Classification** (if accuracy issues)
  - Use LLM to classify ambiguous questions
  - Fallback to keyword-based if LLM fails
  
- ✅ **Query Caching** (Redis)
  - Cache frequent queries (5-minute TTL)
  - Reduce LLM API costs
  
- ✅ **Hybrid Query Optimization**
  - Parallel document + data queries
  - Faster response time for hybrid queries

---

#### 4. Admin Dashboard
- ✅ **Metrics Dashboard**
  - Total queries, guard block rate, response time
  - Top questions, top documents
  - Injection attempt tracking
  
- ✅ **Ingest Management**
  - View ingest status (files processed, errors)
  - Trigger manual ingest
  - View document list (indexed documents)
  
- ✅ **Query Logs**
  - Search query history
  - Filter by user, date, classification
  - Export logs for analysis

---

#### 5. User Feedback Loop
- ✅ **Thumbs Up/Down**
  - Users rate answers (helpful / not helpful)
  - Feedback stored for analysis
  
- ✅ **Report Issue**
  - Users report incorrect answers
  - Admin reviews and improves

---

### WHAT IS NOT BUILT (CONSCIOUS DECISIONS)

#### ❌ Multi-Project Support
- **Reason:** Single site is sufficient for pilot
- **Workaround:** All documents in one project folder
- **Future:** Phase 3

#### ❌ DWG/CAD File Parsing
- **Reason:** Still complex, low demand
- **Workaround:** Drawings with text legends supported
- **Future:** Phase 3 if demand exists

#### ❌ Streaming LLM Responses
- **Reason:** Not critical for UX
- **Workaround:** Loading indicator
- **Future:** Phase 3

#### ❌ Multi-Language Support
- **Reason:** English-only for pilot site
- **Workaround:** All documents in English
- **Future:** Phase 3

#### ❌ Mobile App
- **Reason:** Web app is sufficient
- **Workaround:** Responsive web design
- **Future:** Phase 3 if demand exists

---

### SUCCESS CRITERIA (PHASE 2)

**Technical:**
- ✅ 99% uptime (service availability)
- ✅ 100% source citation rate
- ✅ <5% guard block rate
- ✅ <5 second average response time
- ✅ 0% compliance/safety claims

**User Adoption:**
- ✅ 50% of site engineers use it weekly
- ✅ 100+ queries per week
- ✅ 85% of answers rated "helpful" or "very helpful"

**Business:**
- ✅ Positive ROI (time saved vs. cost)
- ✅ No legal/safety incidents
- ✅ Customer willing to pay for continued use
- ✅ Ready for multi-site scaling

---

## PHASE 3: MULTI-PROJECT SCALING

**Timeline:** 12-16 weeks  
**Goal:** Scale to multiple sites and projects, enterprise features  
**Users:** 100-500 engineers across multiple sites

---

### WHAT IS BUILT

#### 1. Multi-Project Architecture
- ✅ **Project Isolation**
  - Separate vector DB indexes per project
  - Project-specific document folders
  - Project-based access control
  
- ✅ **Project Switching**
  - Users select project in UI
  - Queries scoped to selected project
  
- ✅ **Cross-Project Search** (optional)
  - Search across all projects (admin only)
  - Useful for finding best practices

---

#### 2. Enterprise Features
- ✅ **Role-Based Access Control**
  - Admin, Engineer, Viewer roles
  - Admins can manage ingest, view all queries
  - Engineers can query, view own queries
  - Viewers can query only
  
- ✅ **SSO Integration**
  - SAML / OAuth 2.0 integration
  - Enterprise authentication
  
- ✅ **API for Integrations**
  - REST API for third-party tools
  - Webhooks for query events

---

#### 3. Advanced Features
- ✅ **Streaming LLM Responses**
  - Real-time answer streaming
  - Better UX for long answers
  
- ✅ **DWG/CAD File Parsing** (if demand exists)
  - Extract text from CAD files
  - Support for AutoCAD, Revit
  
- ✅ **Multi-Language Support** (if international projects)
  - Support for Spanish, French, German
  - Language detection and translation

---

#### 4. Performance Optimization
- ✅ **Horizontal Scaling**
  - Multiple backend instances behind load balancer
  - Auto-scaling based on load
  
- ✅ **Query Optimization**
  - Parallel retrieval (vector + database)
  - Reduced latency (<3 seconds)
  
- ✅ **Cost Optimization**
  - Aggressive caching (Redis)
  - Batch embedding generation
  - LLM token usage optimization

---

#### 5. Analytics & Insights
- ✅ **Usage Analytics**
  - Queries per project, per user
  - Most asked questions
  - Document usage (most queried documents)
  
- ✅ **Quality Metrics**
  - Answer accuracy (user ratings)
  - Guard effectiveness (block rate)
  - Source citation rate
  
- ✅ **Business Insights**
  - Time saved per user
  - ROI calculation
  - Cost per query

---

### WHAT IS NOT BUILT (CONSCIOUS DECISIONS)

#### ❌ Mobile App (Native)
- **Reason:** Responsive web app is sufficient
- **Workaround:** Progressive Web App (PWA)
- **Future:** Only if strong demand

#### ❌ Voice Interface
- **Reason:** Not critical for construction sites
- **Workaround:** Text-based queries
- **Future:** Only if strong demand

#### ❌ Image/Photo Analysis
- **Reason:** Out of scope for document-based RAG
- **Workaround:** Photos stored in Google Drive, not analyzed
- **Future:** Separate feature (not RAG)

#### ❌ Predictive Analytics
- **Reason:** RAG is for retrieval, not prediction
- **Workaround:** Separate analytics module
- **Future:** Separate feature (not RAG)

---

### SUCCESS CRITERIA (PHASE 3)

**Technical:**
- ✅ 99.9% uptime (enterprise SLA)
- ✅ 100% source citation rate
- ✅ <3% guard block rate
- ✅ <3 second average response time
- ✅ 0% compliance/safety claims

**User Adoption:**
- ✅ 70% of engineers use it weekly
- ✅ 1,000+ queries per week
- ✅ 90% of answers rated "helpful" or "very helpful"

**Business:**
- ✅ Strong ROI across all projects
- ✅ No legal/safety incidents
- ✅ Customer retention (renewal rate >90%)
- ✅ Expansion to new customers

---

## TIMELINE SUMMARY

| Phase | Duration | Users | Queries/Week | Key Milestone |
|-------|----------|-------|--------------|---------------|
| **Phase 1: MVP** | 6-8 weeks | 5-10 | 50-100 | Core functionality validated |
| **Phase 2: Pilot** | 8-12 weeks | 20-50 | 100-500 | Single site deployment, positive ROI |
| **Phase 3: Scaling** | 12-16 weeks | 100-500 | 1,000+ | Multi-project, enterprise features |
| **Total** | 26-36 weeks | - | - | Production-grade, scalable system |

---

## COST ESTIMATES (MONTHLY)

### Phase 1: MVP (Internal Use)
- **LLM API** (OpenAI GPT-4): $50-100 (100 queries/week)
- **Embedding API** (OpenAI): $20-50 (one-time ingest + updates)
- **Vector DB** (Pinecone): $70 (starter plan)
- **Cloud Hosting** (AWS EC2): $50-100 (small instance)
- **Total**: ~$200-300/month

### Phase 2: Paid Pilot (Single Site)
- **LLM API**: $200-500 (500 queries/week)
- **Embedding API**: $50-100 (incremental updates)
- **Vector DB** (Pinecone): $70-200 (standard plan)
- **Cloud Hosting**: $100-200 (medium instance)
- **Monitoring** (Sentry, Datadog): $50-100
- **Total**: ~$500-1,000/month

### Phase 3: Multi-Project Scaling
- **LLM API**: $1,000-2,000 (1,000+ queries/week)
- **Embedding API**: $100-200 (multiple projects)
- **Vector DB**: $200-500 (enterprise plan)
- **Cloud Hosting**: $300-500 (auto-scaling)
- **Monitoring**: $100-200
- **Total**: ~$2,000-3,500/month

**Revenue Model:**
- Phase 1: Internal use (no revenue)
- Phase 2: $500-1,000/month per site (break-even)
- Phase 3: $1,000-2,000/month per site (profitable)

---

## RISK MITIGATION

### Technical Risks
- **LLM API Downtime**: Fallback to cached responses, graceful degradation
- **Vector DB Downtime**: Daily backups, disaster recovery plan
- **Hallucination**: Guard agents, audit logging, user feedback
- **Prompt Injection**: Input sanitization, output validation

### Business Risks
- **Low Adoption**: User training, onboarding, feedback loop
- **High Costs**: Caching, batch processing, cost optimization
- **Legal Liability**: Disclaimer, guardrails, no compliance claims

### Operational Risks
- **Data Quality**: Manual review of ingested documents
- **User Errors**: Clear error messages, help documentation
- **Scalability**: Horizontal scaling, load testing

---

## CONCLUSION

This roadmap defines a realistic, phased approach to deploying the CEW AI Assistant:

1. **Phase 1 (MVP)**: Validate core functionality with internal team (6-8 weeks)
2. **Phase 2 (Pilot)**: Deploy to one site, gather feedback, iterate (8-12 weeks)
3. **Phase 3 (Scaling)**: Scale to multiple sites, enterprise features (12-16 weeks)

**Key Principles:**
- Start small, validate, then scale
- Production-grade from day one (no "demo" code)
- Conscious decisions about what NOT to build
- Focus on core RAG functionality, not feature bloat

**Total Timeline:** 26-36 weeks from start to enterprise-ready system

---

**End of Roadmap Document**
