# CEW AI Service

RAG-based AI Assistant service for the Construction Engineering Workflow (CEW) application. This service provides document Q&A capabilities using retrieval-augmented generation.

## Features

- **Document Ingestion**: Process PDF, DOCX, XLSX, TXT, and CSV files
- **Vector Search**: Semantic search using embeddings stored in ChromaDB
- **Query Classification**: Automatically classifies queries as document, data, hybrid, or conversational
- **OCR Support**: Extract text from scanned PDFs using Tesseract.js
- **Conversation History**: Maintain context across multiple queries
- **Source Citations**: Responses include relevant source references

## Architecture

```
ai-service/
├── src/
│   ├── config/          # Environment configuration
│   ├── ingest/          # Document processing pipeline
│   │   ├── documentLoader.ts   # Load various file formats
│   │   ├── chunker.ts          # Split documents into chunks
│   │   ├── embedder.ts         # Generate embeddings
│   │   └── indexer.ts          # Store in vector database
│   ├── query/           # Query processing
│   │   ├── retriever.ts        # Retrieve relevant chunks
│   │   ├── queryClassifier.ts  # Classify query type
│   │   └── responseGenerator.ts # Generate responses
│   ├── services/        # External services
│   │   ├── llmService.ts       # OpenAI API
│   │   ├── ocrService.ts       # Tesseract OCR
│   │   └── policyService.ts    # Input validation
│   ├── connectors/      # Data source connectors
│   │   ├── localDocConnector.ts    # Local file system
│   │   └── cewQAQCConnector.ts     # CEW QA/QC integration
│   ├── routes/          # API endpoints
│   │   ├── chat.ts             # Chat API
│   │   ├── ingest.ts           # Document ingestion API
│   │   └── health.ts           # Health checks
│   └── server.ts        # Express server entry point
├── documents/           # Document storage (gitignored)
├── index-store/         # Vector index storage (gitignored)
└── package.json
```

## Prerequisites

- Node.js 18+
- ChromaDB server (or use in-memory for development)
- OpenAI API key

## Installation

```bash
# Navigate to ai-service directory
cd ai-service

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# Required: OPENAI_API_KEY
```

## Configuration

Edit `.env` file with your settings:

```env
# Required
OPENAI_API_KEY=sk-your-api-key-here

# Optional - defaults shown
PORT=3001
NODE_ENV=development
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
VECTOR_STORE_TYPE=chroma
CHROMA_HOST=localhost
CHROMA_PORT=8000
```

## Running the Service

```bash
# Development mode with auto-reload
npm run dev

# Production build
npm run build
npm start
```

## API Endpoints

### Chat

```http
POST /api/chat
Content-Type: application/json

{
  "query": "What are the safety requirements for concrete work?",
  "conversationId": "optional-conversation-id",
  "filters": {
    "documentTypes": ["pdf"],
    "tags": ["safety"]
  },
  "maxResults": 5
}
```

Response:
```json
{
  "success": true,
  "data": {
    "answer": "According to the safety manual...",
    "sources": [
      {
        "documentId": "doc-123",
        "documentName": "Safety_Manual.pdf",
        "pageNumber": 15,
        "excerpt": "...",
        "relevanceScore": 0.92
      }
    ],
    "queryType": "document",
    "confidence": 0.85,
    "conversationId": "conv-456"
  }
}
```

### Document Ingestion

```http
POST /api/ingest
Content-Type: application/json

{
  "filepath": "/path/to/document.pdf",
  "source": "local",
  "tags": ["safety", "concrete"]
}
```

### Scan Documents Folder

```http
POST /api/ingest/scan
```

### Health Check

```http
GET /api/health
GET /api/health/detailed
```

## Document Processing Pipeline

1. **Load**: Parse document based on file type (PDF, DOCX, XLSX, etc.)
2. **OCR** (if needed): Extract text from scanned images
3. **Chunk**: Split content into overlapping chunks (default: 1000 chars, 200 overlap)
4. **Embed**: Generate vector embeddings using OpenAI
5. **Index**: Store in ChromaDB for semantic search

## Query Processing Pipeline

1. **Validate**: Check input against policy rules
2. **Classify**: Determine query type (document/data/hybrid/conversational)
3. **Retrieve**: Find relevant document chunks via vector similarity
4. **Rerank**: Score results based on keyword relevance
5. **Generate**: Create response using LLM with retrieved context

## Integration with CEW

The service includes a connector for CEW QA/QC storage (`cewQAQCConnector.ts`). Configure with:

```env
CEW_API_URL=http://localhost:5000
CEW_API_KEY=your-cew-api-key
```

## Development

```bash
# Run tests
npm test

# Lint code
npm run lint

# Build TypeScript
npm run build
```

## Docker (Future)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

## License

ISC
