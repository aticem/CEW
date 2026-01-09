# CEW AI SERVICE – FOLDER STRUCTURE

**Version:** 1.0  
**Date:** 2026-01-06  
**Purpose:** Define exact folder structure and responsibilities for production-grade AI backend service

---

## COMPLETE FOLDER STRUCTURE

```
ai-service/
├─ src/
│  ├─ ingest/
│  │  ├─ drive/
│  │  │  ├─ driveClient.js          # Google Drive API client
│  │  │  ├─ fileListService.js      # List files from CEW_AI/ folder
│  │  │  └─ fileDownloadService.js  # Download file content
│  │  ├─ parsers/
│  │  │  ├─ pdfParser.js            # PDF text extraction
│  │  │  ├─ excelParser.js          # Excel BOM parsing
│  │  │  ├─ wordParser.js           # Word document parsing
│  │  │  ├─ documentClassifier.js   # Classify PDF_TEXT, PDF_DRAWING, SCANNED_PDF
│  │  │  └─ parserFactory.js        # Factory to select correct parser
│  │  ├─ chunking/
│  │  │  ├─ textChunker.js          # Chunk text with overlap
│  │  │  ├─ excelChunker.js         # Chunk Excel rows/sheets
│  │  │  └─ chunkingStrategy.js     # Configurable chunking rules
│  │  ├─ embeddings/
│  │  │  ├─ embeddingService.js     # Generate embeddings (abstracted)
│  │  │  └─ batchEmbedding.js       # Batch processing for efficiency
│  │  ├─ metadata/
│  │  │  ├─ metadataExtractor.js    # Extract doc_name, page, section, folder
│  │  │  └─ metadataSchema.js       # Define metadata structure
│  │  ├─ ingestPipeline.js          # Main orchestrator for ingest flow
│  │  └─ ingestController.js        # API controller for /api/ingest/*
│  │
│  ├─ query/
│  │  ├─ agents/
│  │  │  ├─ queryAgent.js           # Classify question into categories
│  │  │  ├─ guardAgent.js           # Pre/post validation logic
│  │  │  └─ agentRules.js           # Rules for classification & validation
│  │  ├─ retrieval/
│  │  │  ├─ retrievalService.js     # Vector search orchestration
│  │  │  ├─ queryEmbedding.js       # Generate embedding for user question
│  │  │  └─ chunkRanker.js          # Rank and filter retrieved chunks
│  │  ├─ llm/
│  │  │  ├─ llmService.js           # LLM API client (abstracted)
│  │  │  ├─ promptBuilder.js        # Build prompts from templates + chunks
│  │  │  └─ responseParser.js       # Parse LLM response
│  │  ├─ database/
│  │  │  ├─ cewDbClient.js          # CEW database read-only client
│  │  │  ├─ queryBuilder.js         # Build SQL queries from natural language
│  │  │  └─ resultFormatter.js      # Format DB results for LLM
│  │  ├─ sources/
│  │  │  ├─ sourceExtractor.js      # Extract sources from chunks
│  │  │  └─ sourceFormatter.js      # Format sources for frontend
│  │  ├─ queryPipeline.js           # Main orchestrator for query flow
│  │  └─ queryController.js         # API controller for /api/query
│  │
│  ├─ vector/
│  │  ├─ providers/
│  │  │  ├─ pineconeProvider.js     # Pinecone implementation
│  │  │  ├─ qdrantProvider.js       # Qdrant implementation
│  │  │  ├─ weaviateProvider.js     # Weaviate implementation
│  │  │  └─ chromaProvider.js       # Chroma implementation (dev only)
│  │  ├─ vectorDbInterface.js       # Abstract interface for all providers
│  │  ├─ vectorDbFactory.js         # Factory to select provider from config
│  │  └─ vectorDbClient.js          # Unified client (uses factory)
│  │
│  ├─ prompts/
│  │  ├─ system/
│  │  │  ├─ systemPrompt.txt        # Core system rules
│  │  │  ├─ guardRules.txt          # Guard agent rules
│  │  │  └─ fallbackResponse.txt    # Fallback when no answer found
│  │  ├─ query/
│  │  │  ├─ classificationPrompt.txt    # Query classification prompt
│  │  │  ├─ answerPrompt.txt            # Main answer generation prompt
│  │  │  └─ databaseQueryPrompt.txt     # Database query generation prompt
│  │  ├─ templates/
│  │  │  ├─ promptTemplate.js       # Template engine (mustache/handlebars)
│  │  │  └─ variableInjector.js     # Inject variables into templates
│  │  └─ promptLoader.js            # Load and cache prompts
│  │
│  ├─ api/
│  │  ├─ routes/
│  │  │  ├─ ingestRoutes.js         # POST /api/ingest/trigger, GET /api/ingest/status
│  │  │  ├─ queryRoutes.js          # POST /api/query
│  │  │  └─ healthRoutes.js         # GET /health
│  │  ├─ middleware/
│  │  │  ├─ errorHandler.js         # Global error handling
│  │  │  ├─ rateLimiter.js          # Rate limiting per IP
│  │  │  ├─ validator.js            # Input validation
│  │  │  ├─ cors.js                 # CORS configuration
│  │  │  └─ logger.js               # Request/response logging
│  │  ├─ server.js                  # Express app setup
│  │  └─ app.js                     # Main entry point
│  │
│  ├─ config/
│  │  ├─ env.js                     # Environment variable loader
│  │  ├─ vectorDb.config.js         # Vector DB configuration
│  │  ├─ llm.config.js              # LLM provider configuration
│  │  ├─ drive.config.js            # Google Drive configuration
│  │  ├─ database.config.js         # CEW database configuration
│  │  ├─ chunking.config.js         # Chunking strategy configuration
│  │  └─ app.config.js              # General app configuration
│  │
│  ├─ utils/
│  │  ├─ logger.js                  # Winston/Pino logger
│  │  ├─ errors.js                  # Custom error classes
│  │  ├─ retry.js                   # Retry logic for API calls
│  │  └─ validation.js              # Validation helpers
│  │
│  └─ types/
│     ├─ document.types.js          # Document type definitions
│     ├─ chunk.types.js             # Chunk type definitions
│     ├─ query.types.js             # Query type definitions
│     └─ response.types.js          # Response type definitions
│
├─ tests/
│  ├─ unit/
│  │  ├─ ingest/
│  │  ├─ query/
│  │  ├─ vector/
│  │  └─ prompts/
│  ├─ integration/
│  │  ├─ ingestPipeline.test.js
│  │  ├─ queryPipeline.test.js
│  │  └─ vectorDb.test.js
│  └─ e2e/
│     └─ fullFlow.test.js
│
├─ scripts/
│  ├─ setup-drive.js                # Setup Google Drive service account
│  ├─ setup-vectordb.js             # Initialize vector database
│  ├─ test-ingest.js                # Test ingest with sample docs
│  └─ test-query.js                 # Test query with sample questions
│
├─ docs/
│  ├─ API.md                        # API documentation
│  ├─ DEPLOYMENT.md                 # Deployment guide
│  └─ TROUBLESHOOTING.md            # Common issues and solutions
│
├─ .env.example                     # Example environment variables
├─ .gitignore                       # Git ignore rules
├─ package.json                     # Node.js dependencies
├─ package-lock.json                # Locked dependencies
├─ README.md                        # Service overview
└─ Dockerfile                       # Docker container definition
```

---

## FOLDER RESPONSIBILITIES

### 1. `src/ingest/`
**Purpose:** Document ingestion pipeline from Google Drive to Vector Database

#### `src/ingest/drive/`
- **driveClient.js**: Initialize Google Drive API client with service account
- **fileListService.js**: List all files in `CEW_AI/` folder recursively
- **fileDownloadService.js**: Download file content as buffer/stream

#### `src/ingest/parsers/`
- **pdfParser.js**: Extract text from PDF files (pdf-parse library)
- **excelParser.js**: Parse Excel files, extract sheets, rows, columns (exceljs)
- **wordParser.js**: Parse Word documents (mammoth library)
- **documentClassifier.js**: Classify PDFs into PDF_TEXT, PDF_DRAWING, SCANNED_PDF
- **parserFactory.js**: Select correct parser based on file extension

#### `src/ingest/chunking/`
- **textChunker.js**: Split text into semantic chunks with overlap (500 tokens, 50 overlap)
- **excelChunker.js**: Chunk Excel data (per row or per sheet)
- **chunkingStrategy.js**: Configurable chunking rules (chunk size, overlap, strategy)

#### `src/ingest/embeddings/`
- **embeddingService.js**: Generate embeddings (abstracted, supports OpenAI/Cohere/local)
- **batchEmbedding.js**: Batch process chunks for efficiency (reduce API calls)

#### `src/ingest/metadata/`
- **metadataExtractor.js**: Extract metadata (doc_name, page, section, folder, updated_at)
- **metadataSchema.js**: Define metadata structure and validation

#### `src/ingest/ingestPipeline.js`
- **Orchestrator**: Coordinate entire ingest flow
- **Steps**: List files → Download → Parse → Classify → Chunk → Embed → Upsert to Vector DB
- **Error handling**: Log failures, continue with next file

#### `src/ingest/ingestController.js`
- **API Controller**: Handle `/api/ingest/trigger` and `/api/ingest/status`
- **Trigger ingest**: Start ingest pipeline manually
- **Status check**: Return progress (files processed, chunks created, errors)

---

### 2. `src/query/`
**Purpose:** Query pipeline from user question to answer with sources

#### `src/query/agents/`
- **queryAgent.js**: Classify question into categories (Definition, Selection, Technical Value, Drawing Reference, CEW System Data)
- **guardAgent.js**: Pre-validation (check chunk relevance) and post-validation (check answer quality)
- **agentRules.js**: Rules for classification and validation logic

#### `src/query/retrieval/`
- **retrievalService.js**: Orchestrate vector search (generate query embedding, search, rank)
- **queryEmbedding.js**: Generate embedding for user question
- **chunkRanker.js**: Rank retrieved chunks by relevance, filter low-quality chunks

#### `src/query/llm/`
- **llmService.js**: LLM API client (abstracted, supports OpenAI/Anthropic/Azure)
- **promptBuilder.js**: Build prompts from templates + retrieved chunks + question
- **responseParser.js**: Parse LLM response, extract answer and sources

#### `src/query/database/`
- **cewDbClient.js**: CEW database read-only client (PostgreSQL/MySQL)
- **queryBuilder.js**: Build SQL queries from natural language (for CEW System Data questions)
- **resultFormatter.js**: Format database results for LLM consumption

#### `src/query/sources/`
- **sourceExtractor.js**: Extract sources from retrieved chunks (doc_name, page, section)
- **sourceFormatter.js**: Format sources for frontend display

#### `src/query/queryPipeline.js`
- **Orchestrator**: Coordinate entire query flow
- **Steps**: Classify → Retrieve → Guard (pre) → LLM → Guard (post) → Format sources
- **Fallback**: Return fallback response if any step fails

#### `src/query/queryController.js`
- **API Controller**: Handle `/api/query`
- **Input**: User question
- **Output**: Answer + sources (or fallback response)

---

### 3. `src/vector/`
**Purpose:** Vector database abstraction layer (provider-agnostic)

#### `src/vector/providers/`
- **pineconeProvider.js**: Pinecone implementation (upsert, query, delete)
- **qdrantProvider.js**: Qdrant implementation
- **weaviateProvider.js**: Weaviate implementation
- **chromaProvider.js**: Chroma implementation (local dev only)

#### `src/vector/vectorDbInterface.js`
- **Abstract Interface**: Define common methods (upsert, query, delete, listIndexes)
- **Purpose**: Ensure all providers implement same interface

#### `src/vector/vectorDbFactory.js`
- **Factory Pattern**: Select provider based on config (e.g., `VECTOR_DB_PROVIDER=pinecone`)
- **Purpose**: Switch providers without changing code

#### `src/vector/vectorDbClient.js`
- **Unified Client**: Use factory to get provider, expose unified API
- **Purpose**: Single entry point for all vector DB operations

---

### 4. `src/prompts/`
**Purpose:** Prompt templates separated from code (easy to update without code changes)

#### `src/prompts/system/`
- **systemPrompt.txt**: Core system rules (no guessing, source-backed answers, technical language)
- **guardRules.txt**: Guard agent validation rules
- **fallbackResponse.txt**: Fallback response when no answer found

#### `src/prompts/query/`
- **classificationPrompt.txt**: Prompt for query classification
- **answerPrompt.txt**: Main prompt for answer generation
- **databaseQueryPrompt.txt**: Prompt for database query generation

#### `src/prompts/templates/`
- **promptTemplate.js**: Template engine (mustache/handlebars) to inject variables
- **variableInjector.js**: Inject variables (chunks, question, metadata) into templates

#### `src/prompts/promptLoader.js`
- **Loader**: Load prompts from files, cache in memory
- **Purpose**: Avoid reading files on every request

---

### 5. `src/api/`
**Purpose:** REST API layer (Express.js)

#### `src/api/routes/`
- **ingestRoutes.js**: Define routes for ingest endpoints
- **queryRoutes.js**: Define routes for query endpoints
- **healthRoutes.js**: Define health check endpoint

#### `src/api/middleware/`
- **errorHandler.js**: Global error handling (catch all errors, return JSON)
- **rateLimiter.js**: Rate limiting per IP (prevent abuse)
- **validator.js**: Input validation (validate request body, params)
- **cors.js**: CORS configuration (allow CEW frontend origin)
- **logger.js**: Request/response logging (Winston/Pino)

#### `src/api/server.js`
- **Express App Setup**: Initialize Express, apply middleware, register routes
- **Purpose**: Separate app setup from entry point

#### `src/api/app.js`
- **Entry Point**: Start server, listen on port
- **Purpose**: Main entry point for `node src/api/app.js`

---

### 6. `src/config/`
**Purpose:** Configuration files (environment-specific settings)

- **env.js**: Load environment variables from `.env` file
- **vectorDb.config.js**: Vector DB configuration (provider, API key, index name)
- **llm.config.js**: LLM provider configuration (OpenAI/Anthropic, API key, model)
- **drive.config.js**: Google Drive configuration (service account, folder ID)
- **database.config.js**: CEW database configuration (connection string, read-only)
- **chunking.config.js**: Chunking strategy configuration (chunk size, overlap)
- **app.config.js**: General app configuration (port, log level, rate limits)

---

### 7. `src/utils/`
**Purpose:** Utility functions (reusable across modules)

- **logger.js**: Winston/Pino logger (structured logging)
- **errors.js**: Custom error classes (IngestError, QueryError, VectorDbError)
- **retry.js**: Retry logic for API calls (exponential backoff)
- **validation.js**: Validation helpers (validate email, URL, etc.)

---

### 8. `src/types/`
**Purpose:** Type definitions (JSDoc or TypeScript types)

- **document.types.js**: Document type definitions (PDF_TEXT, PDF_DRAWING, EXCEL_BOM)
- **chunk.types.js**: Chunk type definitions (text, metadata, embedding)
- **query.types.js**: Query type definitions (question, category, filters)
- **response.types.js**: Response type definitions (answer, sources, success)

---

### 9. `tests/`
**Purpose:** Test suite (unit, integration, e2e)

#### `tests/unit/`
- Test individual functions (parsers, chunkers, embeddings, etc.)

#### `tests/integration/`
- Test pipelines (ingest pipeline, query pipeline, vector DB operations)

#### `tests/e2e/`
- Test full flow (ingest → query → answer)

---

### 10. `scripts/`
**Purpose:** Setup and testing scripts

- **setup-drive.js**: Setup Google Drive service account, test connection
- **setup-vectordb.js**: Initialize vector database, create indexes
- **test-ingest.js**: Test ingest with sample documents
- **test-query.js**: Test query with sample questions

---

### 11. `docs/`
**Purpose:** Service documentation

- **API.md**: API documentation (endpoints, request/response formats)
- **DEPLOYMENT.md**: Deployment guide (Docker, cloud hosting)
- **TROUBLESHOOTING.md**: Common issues and solutions

---

## KEY DESIGN PRINCIPLES

### 1. **Separation of Concerns**
- Ingest and query pipelines are completely separate
- Each module has a single responsibility
- Easy to test and maintain

### 2. **Abstraction**
- Vector DB abstraction (switch providers without code changes)
- LLM abstraction (switch LLM providers without code changes)
- Prompt templates separated from code

### 3. **Scalability**
- Modular design allows horizontal scaling
- Batch processing for embeddings
- Queue-based ingest (future: Bull/BullMQ)

### 4. **Testability**
- Each module can be tested independently
- Mock providers for testing (mock vector DB, mock LLM)
- Integration tests for pipelines

### 5. **Configuration-Driven**
- All settings in config files
- Environment variables for secrets
- Easy to switch between dev/staging/prod

### 6. **Production-Ready**
- Error handling at every layer
- Logging and monitoring
- Rate limiting and validation
- Retry logic for API calls

---

## NEXT STEPS

1. **Create folder structure** (mkdir commands)
2. **Initialize package.json** (dependencies)
3. **Create .env.example** (environment variables)
4. **Implement core modules** (vector DB, LLM, parsers)
5. **Implement ingest pipeline** (Google Drive → Vector DB)
6. **Implement query pipeline** (Question → Answer)
7. **Create API routes** (Express.js)
8. **Write tests** (unit, integration, e2e)
9. **Deploy to production** (Docker, cloud hosting)

---

**End of Folder Structure Document**
