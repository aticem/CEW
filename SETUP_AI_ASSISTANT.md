# CEW AI Assistant - Setup Guide

## Overview

The AI Assistant is now fully integrated into CEW with a **local-first, enterprise-safe architecture**.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CEW1 Frontend (React)                                       │
│  - AI Assistant floating panel (bottom-right)                │
│  - Documents / Progress tabs                                 │
│  - No LLM keys exposed                                       │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTP/JSON
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  AI Service Backend (Node.js - Port 3001)                   │
│  - Document parsing (Word/PDF/Excel)                         │
│  - Text chunking + embeddings                                │
│  - RAG query pipeline                                        │
│  - LLM integration (OpenAI)                                  │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Qdrant Vector Database (Port 6333)                         │
│  - Stores document embeddings                                │
│  - Semantic search                                           │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start Qdrant (Vector Database)

```bash
docker run -p 6333:6333 qdrant/qdrant
```

### 2. Setup AI Service

```bash
cd ai-service

# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Edit .env and add your OpenAI API key
# OPENAI_API_KEY=sk-your-key-here
```

### 3. Ingest Documents

Place documents in `ai-service/documents/` then run:

```bash
npm run ingest
```

This will:
- Parse all documents (PDF, Word, Excel)
- Chunk text into semantic segments
- Generate embeddings
- Store in Qdrant vector database

### 4. Start AI Service

```bash
npm start
# Service runs on http://localhost:3001
```

### 5. Start CEW1 Frontend

```bash
cd CEW1/_root
npm run dev
# Frontend runs on http://localhost:5173
```

### 6. Use AI Assistant

1. Open CEW1 in browser: `http://localhost:5173`
2. Click the blue chat icon in bottom-right corner
3. Ask questions about your project documents
4. View sources with each answer

## Features

### ✅ Local-First Architecture
- Documents stored in `/ai-service/documents/`
- No external document uploads
- Full data control

### ✅ No Hallucination
- Answers only from indexed documents
- Guard agents ensure source-backed responses
- Fallback if information not found

### ✅ Full Traceability
- Every answer includes document sources
- Page numbers and sections referenced
- Document name, type, and relevance score

### ✅ Security-First
- LLM API keys never exposed to frontend
- Backend-only AI operations
- Read-only document access

### ✅ Production-Ready
- Error handling and logging
- Rate limiting
- Health checks
- CORS configuration

## API Endpoints

### Health Check
```bash
curl http://localhost:3001/health
```

### Query Documents
```bash
curl -X POST http://localhost:3001/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the technical description?"}'
```

### Trigger Ingest
```bash
curl -X POST http://localhost:3001/api/ingest/trigger
```

### Check Ingest Status
```bash
curl http://localhost:3001/api/ingest/status
```

## Document Support

### Supported Formats
- ✅ **PDF**: Text-extractable PDFs (no OCR in MVP)
- ✅ **Word**: .docx, .doc
- ✅ **Excel**: .xlsx, .xls

### Document Processing
1. **Parsing**: Extract text, tables, structure
2. **Chunking**: Split into 500-token segments with 50-token overlap
3. **Embedding**: Generate semantic vectors (OpenAI text-embedding-3-small)
4. **Storage**: Store in Qdrant with full metadata

## UI Features

### Floating Panel
- **Position**: Bottom-right corner
- **Z-index**: 2000 (doesn't interfere with maps/modules)
- **Responsive**: 400px wide, 600px tall
- **Collapsible**: Minimize to chat icon

### Two Tabs
1. **Documents**: Query project documentation
2. **Progress Data**: Query progress/QA data (future)

### Message Display
- User messages (blue, right-aligned)
- AI responses (white, left-aligned)
- Error messages (red border)
- Loading indicator (animated dots)
- Source citations with each answer
- Timestamps

## Architecture Principles

### 1. AI as Reasoning Engine
- LLM only processes structured, parsed data
- No raw document upload to LLM
- Local parsing handles all document processing

### 2. Source-Constrained
- Answers only from indexed documents
- No external knowledge
- No guessing or inference

### 3. Zero Hallucination
- Guard agents validate relevance
- Fallback responses for missing info
- Source validation

## Troubleshooting

### AI Service won't start
- Check Qdrant is running on port 6333
- Verify OPENAI_API_KEY in .env
- Check logs in `ai-service/logs/`

### No answers from AI
- Run ingest: `npm run ingest`
- Check documents are in `/ai-service/documents/`
- Verify Qdrant collection: `curl http://localhost:6333/collections`

### Frontend can't connect
- Verify AI service running on port 3001
- Check CORS settings in AI service `.env`
- Look for red health indicator in AI Assistant

## Directory Structure

```
CEW/
├── ai-service/                 # AI Backend Service
│   ├── documents/              # Document storage
│   │   └── Technical Description_Rev01.docx
│   ├── src/
│   │   ├── ingest/            # Document ingestion
│   │   ├── query/             # Query processing
│   │   ├── vector/            # Vector DB client
│   │   ├── prompts/           # LLM prompts
│   │   └── api/               # Express routes
│   ├── package.json
│   ├── .env
│   └── README.md
│
└── CEW1/_root/                 # Frontend Application
    └── src/
        ├── components/
        │   └── AIAssistant.jsx # AI Assistant UI
        └── App.jsx            # Main app (with AI integrated)
```

## Next Steps

### Add More Documents
1. Place documents in `ai-service/documents/`
2. Run `npm run ingest` from ai-service directory
3. Documents are now searchable

### Production Deployment
1. Deploy Qdrant (persistent storage)
2. Deploy AI service (PM2 or Docker)
3. Update CORS_ORIGIN in .env
4. Use environment-specific API keys
5. Enable HTTPS

### Future Enhancements
- Progress Data tab implementation
- Database query integration
- Advanced filtering
- Document management UI
- Multi-language support

## Support

For issues or questions:
1. Check logs: `ai-service/logs/combined.log`
2. Verify service health: `http://localhost:3001/health`
3. Test vector DB: `http://localhost:6333/dashboard`
