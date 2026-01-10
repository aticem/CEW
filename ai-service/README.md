# CEW AI Service

Local-first, enterprise-safe AI Assistant backend for CEW construction project.

## Architecture

- **Document Parsing**: Word, PDF, Excel documents
- **RAG System**: Vector database (Qdrant) with semantic search
- **LLM Integration**: OpenAI GPT-4 as reasoning engine
- **Local-First**: All documents stored locally, no external uploads

## Setup

### 1. Install Dependencies

```bash
cd ai-service
npm install
```

### 2. Start Qdrant (Vector Database)

Using Docker:

```bash
docker run -p 6333:6333 qdrant/qdrant
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```
OPENAI_API_KEY=sk-your-key-here
```

### 4. Add Documents

Place your documents in the `documents/` directory:

```
ai-service/documents/
├── Technical Description_Rev01.docx
├── specifications.pdf
└── bom.xlsx
```

### 5. Ingest Documents

```bash
npm run ingest
```

This will:
- Parse all documents
- Chunk text into semantic segments
- Generate embeddings
- Store in vector database

### 6. Start AI Service

```bash
npm start
```

Service will start on `http://localhost:3001`

## API Endpoints

### Health Check
```
GET /health
```

### Query
```
POST /api/query
{
  "question": "What is the trench depth specification?"
}
```

### Trigger Ingest
```
POST /api/ingest/trigger
```

### Ingest Status
```
GET /api/ingest/status
```

## Development

```bash
npm run dev
```

## Project Structure

```
ai-service/
├── src/
│   ├── ingest/         # Document ingestion pipeline
│   ├── query/          # Query processing pipeline
│   ├── vector/         # Vector database abstraction
│   ├── prompts/        # LLM prompts
│   ├── api/            # Express API routes
│   ├── config/         # Configuration
│   └── utils/          # Utilities
├── documents/          # Local document storage
└── logs/              # Application logs
```

## Key Features

✅ **No Hallucination**: Guard agents ensure source-backed answers  
✅ **Full Traceability**: Every answer includes document sources  
✅ **Local-First**: Documents never leave the repository  
✅ **Security-First**: API keys never exposed to frontend  
✅ **Production-Ready**: Error handling, logging, rate limiting

## Architecture Principles

1. **AI as Reasoning Engine**: LLM only processes structured, parsed data
2. **No OCR**: MVP focuses on text-extractable PDFs
3. **Source-Constrained**: Answers only from indexed documents
4. **Zero External Knowledge**: No guessing, no general knowledge

## Notes

- Place all documents in `/ai-service/documents/`
- Supported formats: `.pdf`, `.docx`, `.doc`, `.xlsx`, `.xls`
- Vector database must be running before starting service
- Re-run ingest after adding new documents
