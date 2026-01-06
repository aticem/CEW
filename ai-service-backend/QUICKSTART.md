# CEW AI Assistant Backend - Quick Start Guide

## ✅ Initial Setup Complete

The backend skeleton has been successfully created and verified working.

## 🚀 Starting the Backend

```bash
cd ai-service-backend
./run.sh
```

The server will start on `http://localhost:8000`

## 🔧 Configuration

Before running in production, update the `.env` file with your actual API keys:

1. **Anthropic API Key**: Get from https://console.anthropic.com/
2. **Pinecone API Key**: Get from https://www.pinecone.io/
3. **Supabase Credentials**: Get from your Supabase project

## 📡 Available Endpoints

### Health & Status
- `GET /` - Basic health check
- `GET /health` - Detailed service status
- `GET /docs` - Interactive API documentation (Swagger UI)
- `GET /redoc` - Alternative API documentation

### Ingestion (Skeleton)
- `POST /api/ingest/document` - Upload and index a document
- `GET /api/ingest/status/{document_id}` - Check ingestion status
- `GET /api/ingest/documents` - List all indexed documents

### Query (Skeleton)
- `POST /api/query/ask` - Ask a question
- `GET /api/query/history` - Get query history

## 🎯 Next Steps

1. **Configure API Keys**: Update `.env` with real credentials
2. **Implement Document Processing**: Add PDF and Excel parsing logic
3. **Implement Vector Search**: Connect to Pinecone for semantic search
4. **Implement Claude Integration**: Add question-answering logic
5. **Add Metadata Storage**: Implement Supabase integration
6. **Frontend Integration**: Connect with CEW React application

## 📝 Testing

```bash
# Test health endpoint
curl http://localhost:8000/health

# View API documentation
open http://localhost:8000/docs
```

## 🏗️ Architecture

The backend follows the strict rules defined in PROJECT_RULES.md:
- ✅ Python 3.12 + FastAPI
- ✅ Separate ingestion and query logic
- ✅ No LangChain or LlamaIndex
- ✅ Documents indexed ONCE, not per query
- ✅ Claude 3.5 Sonnet for LLM
- ✅ Pinecone for vector storage
- ✅ Supabase for metadata
