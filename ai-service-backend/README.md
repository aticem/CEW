# CEW AI Assistant Backend

Document-grounded AI Assistant for solar farm projects using FastAPI, Claude 3.5 Sonnet, and Pinecone.

## Architecture

- **Backend**: Python 3.11+ with FastAPI (async)
- **LLM**: Anthropic Claude 3.5 Sonnet
- **Vector DB**: Pinecone
- **Metadata DB**: Supabase (PostgreSQL)
- **Document Processing**: PyPDF2, openpyxl

## Project Structure

```
ai-service-backend/
├── app/
│   ├── __init__.py
│   ├── main.py           # FastAPI application
│   ├── config.py         # Configuration management
│   └── routers/
│       ├── __init__.py
│       ├── ingest.py     # Document ingestion endpoints
│       └── query.py      # Question/answer endpoints
├── requirements.txt      # Python dependencies
├── .env.example         # Environment variables template
└── README.md            # This file
```

## Setup

1. **Create virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. **Run the application:**
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

## API Endpoints

### Health Check
- `GET /` - Basic health check
- `GET /health` - Detailed service status

### Ingestion
- `POST /api/ingest/document` - Upload and index a document
- `GET /api/ingest/status/{document_id}` - Check ingestion status
- `GET /api/ingest/documents` - List all indexed documents

### Query
- `POST /api/query/ask` - Ask a question
- `GET /api/query/history` - Get query history

## Rules

The AI Assistant follows strict rules:
- Only uses uploaded project documents
- No external knowledge or standards
- If information is not found, explicitly states: "This information was not found in the uploaded documents."
- Always cites sources with document references

## Development Status

✅ Backend skeleton created
⏳ Document ingestion pipeline (next step)
⏳ Vector search and retrieval (next step)
⏳ Claude integration (next step)
⏳ Frontend integration (next step)
