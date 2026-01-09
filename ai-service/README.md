# CEW AI Service

RAG-based AI Assistant for Construction Engineering Workflow (CEW).

## Overview

This service provides intelligent document retrieval and question-answering capabilities for construction engineering workflows. It uses Retrieval-Augmented Generation (RAG) to answer questions based **only** on indexed documents—no hallucination.

### Key Features

- 📄 **Document Ingestion** - PDF, DOCX, XLSX, TXT support
- 🔍 **Semantic Search** - Vector-based retrieval using OpenAI embeddings
- 💬 **Bilingual Support** - Turkish & English responses
- 🧠 **Context-Aware Answers** - Cites sources for every response
- 🔒 **No Hallucination** - Answers only from indexed documents

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CEW AI Service                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  Documents   │───▶│   Ingest     │───▶│ Vector Store │              │
│  │  PDF/DOCX/   │    │  Pipeline    │    │   (Index)    │              │
│  │  XLSX/TXT    │    │              │    │              │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│                             │                    │                      │
│                             ▼                    │                      │
│                      ┌──────────────┐            │                      │
│                      │   Chunker    │            │                      │
│                      │  + Embedder  │            │                      │
│                      └──────────────┘            │                      │
│                                                  │                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────┴───────┐              │
│  │   User       │───▶│   Query      │───▶│  Retriever   │              │
│  │   Query      │    │  Classifier  │    │  (Semantic   │              │
│  │              │    │              │    │   Search)    │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│                             │                    │                      │
│                             ▼                    ▼                      │
│                      ┌──────────────┐    ┌──────────────┐              │
│                      │   Policy     │    │   Context    │              │
│                      │  Validation  │    │  Formatter   │              │
│                      └──────────────┘    └──────────────┘              │
│                             │                    │                      │
│                             ▼                    ▼                      │
│                      ┌─────────────────────────────────┐               │
│                      │          LLM Service            │               │
│                      │    (OpenAI GPT-4o-mini)         │               │
│                      └─────────────────────────────────┘               │
│                                      │                                  │
│                                      ▼                                  │
│                      ┌─────────────────────────────────┐               │
│                      │      Response + Sources         │               │
│                      └─────────────────────────────────┘               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Pipeline Flow

1. **Ingest Pipeline**
   - Load documents (PDF, DOCX, XLSX, TXT)
   - Split into semantic chunks (1000 chars, 200 overlap)
   - Generate embeddings via OpenAI
   - Store in vector index

2. **Query Pipeline**
   - Validate user input (language, length, content)
   - Classify query type (document, data, hybrid)
   - Generate query embedding
   - Retrieve relevant chunks via semantic search
   - Format context for LLM
   - Generate response with source citations

---

## Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 8.0.0
- **OpenAI API Key** - [Get one here](https://platform.openai.com/api-keys)

---

## Setup Instructions

### Quick Setup (Recommended)

**Windows (PowerShell):**
```powershell
cd ai-service
.\scripts\setup.ps1
```

**Linux / macOS:**
```bash
cd ai-service
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### Manual Setup

1. **Install dependencies:**
   ```bash
   cd ai-service
   npm install
   ```

2. **Create configuration:**
   ```bash
   cp .env.example .env
   ```

3. **Add your OpenAI API key:**
   Edit `.env` and set:
   ```
   OPENAI_API_KEY=sk-your-key-here
   ```

4. **Create required folders:**
   ```bash
   mkdir -p documents index-store
   ```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | **Required.** Your OpenAI API key | - |
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment mode | `development` |
| `DOCUMENTS_PATH` | Path to documents folder | `./documents` |
| `INDEX_STORE_PATH` | Path to vector index storage | `./index-store` |
| `LLM_MODEL` | OpenAI chat model | `gpt-4o-mini` |
| `LLM_TEMPERATURE` | Response creativity (0-1) | `0.1` |
| `LLM_MAX_TOKENS` | Max tokens in response | `1000` |
| `EMBEDDING_MODEL` | OpenAI embedding model | `text-embedding-3-small` |
| `CHUNK_SIZE` | Text chunk size (chars) | `1000` |
| `CHUNK_OVERLAP` | Chunk overlap (chars) | `200` |
| `SCORE_THRESHOLD` | Min relevance score | `0.7` |
| `TOP_K` | Max chunks to retrieve | `5` |
| `LOG_LEVEL` | Logging level | `info` |

---

## Running the Service

### 1. Ingest Documents

Before using the chat API, you must ingest documents:

```bash
# Add documents to the documents/ folder, then run:
npx ts-node src/scripts/ingest.ts

# Force re-index (clears existing index):
npx ts-node src/scripts/ingest.ts --force

# Ingest from a specific directory:
npx ts-node src/scripts/ingest.ts --dir ../path/to/docs --category custom
```

### 2. Start the Server

**Development mode (auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

The server will start at `http://localhost:3001`

### 3. Verify It's Working

```bash
# Health check
curl http://localhost:3001/health

# Test chat (replace with your question)
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "MC4 connector nedir?"}'
```

---

## API Endpoints

### Health Check

```
GET /health
```

Returns service status and index statistics.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 12345,
  "indexStats": {
    "totalDocuments": 5,
    "totalChunks": 150
  }
}
```

### Chat

```
POST /api/chat
```

Send a question and receive an AI-generated answer.

**Request:**
```json
{
  "message": "What is MC4 connector?",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "MC4 (Multi-Contact 4mm) connectors are the industry standard for photovoltaic installations...",
  "sources": [
    {
      "type": "document",
      "filename": "technical_manual.pdf",
      "pageNumber": 5,
      "excerpt": "MC4 connectors are rated for 1000V DC...",
      "relevanceScore": 0.89
    }
  ],
  "queryType": "document",
  "confidence": 0.85,
  "conversationId": "conv_abc123",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Documents

```
GET /api/documents
```

List all indexed documents.

### Ingest

```
POST /api/ingest
```

Trigger document ingestion programmatically.

**Request:**
```json
{
  "forceReindex": false
}
```

---

## Testing

### Run Chat Tests

```bash
# Start server first
npm run dev

# In another terminal, run tests
npx ts-node src/scripts/test-chat.ts
```

### Manual Testing

```bash
# Health check
curl http://localhost:3001/health

# Chat in Turkish
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "MC4 konektör nedir?"}'

# Chat in English
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the ITP requirements?"}'
```

---

## Project Structure

```
ai-service/
├── src/
│   ├── config/              # Configuration management
│   │   └── index.ts
│   ├── ingest/              # Document processing pipeline
│   │   ├── documentLoader.ts    # Load PDF, DOCX, XLSX, TXT
│   │   ├── chunker.ts           # Text chunking with overlap
│   │   ├── embedder.ts          # OpenAI embeddings
│   │   └── indexer.ts           # Vector store management
│   ├── query/               # Query processing
│   │   ├── queryClassifier.ts   # Classify query intent
│   │   ├── retriever.ts         # Semantic search
│   │   └── responseGenerator.ts # Orchestrate response
│   ├── services/            # External integrations
│   │   ├── llmService.ts        # OpenAI chat completions
│   │   ├── ocrService.ts        # Tesseract OCR (optional)
│   │   ├── policyService.ts     # Input validation
│   │   └── loggerService.ts     # Winston logging
│   ├── routes/              # Express API routes
│   │   ├── chat.ts
│   │   ├── documents.ts
│   │   ├── health.ts
│   │   ├── ingest.ts
│   │   └── index.ts
│   ├── scripts/             # CLI utilities
│   │   ├── ingest.ts            # Document ingestion script
│   │   └── test-chat.ts         # API test script
│   ├── types/               # TypeScript definitions
│   │   └── index.ts
│   └── server.ts            # Express server entry point
├── scripts/                 # Setup scripts
│   ├── setup.sh                 # Linux/macOS setup
│   └── setup.ps1                # Windows setup
├── documents/               # Source documents (gitignored)
├── index-store/             # Vector index (gitignored)
├── .env.example             # Environment template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Troubleshooting

### "OpenAI API key is required"

Your `.env` file is missing or doesn't have `OPENAI_API_KEY` set.

**Fix:**
```bash
# Check if .env exists
ls -la .env

# If not, create from template
cp .env.example .env

# Edit and add your key
nano .env  # or notepad .env on Windows
```

### "No documents found in directory"

The documents folder is empty or the path is wrong.

**Fix:**
1. Add documents to `./documents/`
2. Verify the path: `ls documents/`
3. Re-run ingestion: `npx ts-node src/scripts/ingest.ts`

### "This information was not found in available documents"

The AI couldn't find relevant content for your question.

**Fix:**
- Rephrase your question with more specific terms
- Check if relevant documents are indexed
- Ensure documents contain the information you're asking about

### "Port 3001 is already in use"

Another process is using the port.

**Fix (Windows):**
```powershell
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

**Fix (Linux/macOS):**
```bash
lsof -i :3001
kill -9 <PID>
```

Or change the port in `.env`:
```
PORT=3002
```

### "Rate limit exceeded" (429)

You're hitting OpenAI's rate limits.

**Fix:**
- Wait a few seconds and retry (automatic backoff is built-in)
- For bulk operations, add delays between requests
- Consider upgrading your OpenAI plan

### "Cannot find module 'xyz'"

Dependencies aren't installed.

**Fix:**
```bash
npm install
```

### TypeScript compilation errors

**Fix:**
```bash
# Check for errors
npm run typecheck

# Rebuild
npm run build
```

---

## Supported File Types

| Format | Extension | Parser | Notes |
|--------|-----------|--------|-------|
| PDF | `.pdf` | pdf-parse | Text extraction, page tracking |
| Word | `.docx` | mammoth | Preserves structure |
| Excel | `.xlsx`, `.xls` | xlsx | Sheet-based chunking |
| Text | `.txt`, `.csv` | native | Direct text reading |

---

## License

ISC
