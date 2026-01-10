# CEW AI Service

AI backend for the CEW Solar Construction App. Provides two modes:
- **General (RAG)**: Answer technical questions from project documents
- **Progress**: Analyze construction progress data

## Quick Start

### 1. Setup Environment

```powershell
# Navigate to ai-service
cd ai-service

# Create virtual environment
python -m venv venv

# Activate virtual environment
.\venv\Scripts\Activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure API Key

Create a `.env` file in the `ai-service` folder:

```
OPENAI_API_KEY=sk-your-openai-api-key-here
```

### 3. Add Documents (for RAG mode)

Place your PDF, XLSX, or DOCX files in the `documents/` folder.

### 4. Run Ingestion

```powershell
python scripts/ingest.py
```

### 5. Start the Server

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

### Health Check
```
GET /health
```

### Query (General Mode - RAG)
```
POST /api/query
{
  "question": "What is the minimum trench depth?",
  "mode": "general"
}
```

### Query (Progress Mode - Data Analysis)
```
POST /api/query
{
  "question": "What is the total work done by SUB-A?",
  "mode": "progress"
}
```

## Response Format

```json
{
  "answer": "The minimum trench depth is 800mm according to the specifications.",
  "source": "Technical Description_Rev01.docx (Page 5)"
}
```

## Language Support

The service automatically detects the question language (English or Turkish) and responds in the same language.

## Tech Stack

- **FastAPI** - Web framework
- **OpenAI** - LLM (gpt-4o-mini) and embeddings (text-embedding-3-small)
- **ChromaDB** - Vector database for RAG
- **Pandas** - Data analysis

## Folder Structure

```
ai-service/
├── app/
│   ├── main.py           # FastAPI entry point
│   ├── config.py         # Configuration
│   ├── routers/          # API endpoints
│   ├── services/         # Business logic
│   ├── prompts/          # LLM prompts
│   └── utils/            # Utilities
├── data/
│   └── mock_db.py        # Progress data
├── documents/            # Documents for RAG
├── scripts/
│   └── ingest.py         # Document ingestion
├── chroma_db/            # Vector database
└── requirements.txt
```
