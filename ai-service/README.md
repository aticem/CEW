# CEW AI Service

Production-ready RAG-based AI Assistant for Construction Engineering Workflow (CEW) system.

## Features

- 📄 **Document Ingestion**: Supports PDF, DOCX, XLSX, and TXT files
- 🔍 **OCR Support**: Automatic text extraction from scanned documents
- 🧠 **RAG Pipeline**: Retrieval-Augmented Generation for accurate answers
- 🌐 **Multilingual**: Supports both English and Turkish
- 🔒 **Safety First**: Built-in guardrails against hallucination
- 📊 **Vector Store**: ChromaDB for efficient similarity search
- 🚀 **REST API**: Clean HTTP endpoints for easy integration

## Architecture

```
Document → Load → OCR → Chunk → Embed → Index (ChromaDB)
                                                  ↓
Query → Classify → Retrieve → LLM → Response
```

## Prerequisites

- Node.js 18+ and npm
- OpenAI API key
- ChromaDB running (optional, uses local embedded version by default)

## Installation

1. **Clone and navigate to ai-service:**
   ```bash
   cd /workspaces/CEW/ai-service
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and set your OpenAI API key:
   ```env
   OPENAI_API_KEY=sk-your-api-key-here
   ```

## Usage

### Development Mode

Start the server in development mode with auto-reload:

```bash
npm run dev
```

Server will be available at `http://localhost:3001`

### Production Mode

Build and run in production:

```bash
npm run build
npm start
```

### Document Ingestion

Ingest a single document:

```bash
npm run ingest /path/to/document.pdf
```

Ingest all documents in a directory:

```bash
npm run ingest /path/to/documents/
```

### Test Chat

Test the RAG pipeline without starting the server:

```bash
npm run test-chat "What are the safety requirements?"
```

## API Endpoints

### Chat

**POST** `/api/chat`

Request body:
```json
{
  "query": "What is the project timeline?",
  "userId": "optional-user-id",
  "conversationId": "optional-conversation-id",
  "language": "en"
}
```

Response:
```json
{
  "answer": "According to the project plan...",
  "sources": [
    {
      "documentId": "uuid",
      "filename": "project-plan.pdf",
      "pageNumber": 5,
      "excerpt": "...",
      "relevanceScore": 0.92
    }
  ],
  "queryType": "DOCUMENT",
  "language": "en",
  "confidence": 0.85,
  "processingTime": 1234,
  "tokenUsage": {
    "prompt": 450,
    "completion": 120,
    "total": 570
  }
}
```

### Document Management

**POST** `/api/ingest` - Ingest a single document
```json
{
  "filepath": "/path/to/document.pdf"
}
```

**POST** `/api/ingest/directory` - Ingest a directory
```json
{
  "dirPath": "/path/to/documents/"
}
```

**GET** `/api/ingest/documents` - List all ingested documents

**DELETE** `/api/ingest/documents/:documentId` - Delete a document

### Health Checks

**GET** `/api/health` - Overall health status

**GET** `/api/health/ready` - Readiness probe

**GET** `/api/health/live` - Liveness probe

## Configuration

All configuration is done through environment variables in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key (required) | - |
| `PORT` | Server port | 3001 |
| `NODE_ENV` | Environment (development/production) | development |
| `CHUNK_SIZE` | Text chunk size for embedding | 1000 |
| `CHUNK_OVERLAP` | Overlap between chunks | 200 |
| `MAX_RETRIEVAL_RESULTS` | Number of chunks to retrieve | 5 |
| `EMBEDDING_MODEL` | OpenAI embedding model | text-embedding-3-small |
| `LLM_MODEL` | OpenAI LLM model | gpt-4-turbo-preview |
| `LLM_TEMPERATURE` | LLM temperature (0-1) | 0.1 |
| `OCR_LANGUAGES` | OCR languages | eng+tur |

## Project Structure

```
ai-service/
├── src/
│   ├── config/           # Configuration management
│   ├── types/            # TypeScript type definitions
│   ├── services/         # Core services (logger, LLM, OCR, policy)
│   ├── ingest/           # Document ingestion pipeline
│   │   ├── documentLoader.ts
│   │   ├── chunker.ts
│   │   ├── embedder.ts
│   │   └── index.ts
│   ├── vector/           # Vector store (ChromaDB)
│   ├── query/            # Query processing
│   │   ├── queryClassifier.ts
│   │   ├── retriever.ts
│   │   └── responseGenerator.ts
│   ├── routes/           # API routes
│   ├── scripts/          # CLI scripts
│   └── server.ts         # Main server file
├── data/                 # Data directory (created at runtime)
│   ├── documents/        # Document storage
│   ├── vector-store/     # Vector database
│   └── documents-registry.json
├── logs/                 # Log files
└── package.json
```

## Development

### Code Style

The project uses TypeScript with strict mode enabled. Follow these guidelines:

- Use explicit types where possible
- Document all public functions with JSDoc
- Use singleton pattern for services
- Implement proper error handling and logging

### Adding New Document Types

1. Add parser in `src/ingest/documentLoader.ts`
2. Update `SUPPORTED_EXTENSIONS` array
3. Implement extraction logic
4. Update documentation

### Extending Query Types

1. Add new type to `QueryType` enum in `src/types/index.ts`
2. Update classifier in `src/query/queryClassifier.ts`
3. Add handler in `src/query/responseGenerator.ts`

## Troubleshooting

### "Missing required environment variables: OPENAI_API_KEY"

Make sure you've created a `.env` file and set a valid OpenAI API key.

### "Vector store initialization failed"

If using external ChromaDB, ensure it's running and accessible at the configured URL.

### "No relevant documents found"

Ingest documents first using `npm run ingest <path>` before querying.

### OCR not working properly

OCR for scanned PDFs requires additional setup. Current implementation uses basic text extraction with OCR detection.

## Security

- Never commit `.env` file or API keys
- Use HTTPS in production
- Implement rate limiting for public APIs
- Validate all user inputs
- Regular security audits recommended

## Performance Tips

- Adjust `CHUNK_SIZE` and `CHUNK_OVERLAP` for your use case
- Use appropriate `MAX_RETRIEVAL_RESULTS` (5-10 recommended)
- Monitor token usage to control costs
- Consider caching for frequently asked questions

## License

MIT

## Support

For issues and questions, please refer to the project documentation or create an issue in the repository.

## Roadmap

- [ ] Database query integration for real-time data
- [ ] Conversation history and context
- [ ] Multi-user support with authentication
- [ ] Advanced OCR for scanned documents
- [ ] Document update tracking
- [ ] Query analytics and insights
- [ ] Fine-tuning support
- [ ] Hybrid search (keyword + semantic)

---

Built with ❤️ for the CEW Team
