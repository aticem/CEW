# CEW AI-SERVICE — IMPLEMENTATION PLAN (MVP)

**Version:** 1.0  
**Date:** 2026-01-10  
**Status:** Ready for Implementation  
**Author:** AI Architect + PM

---

## 1. EXECUTIVE SUMMARY

This document defines the complete implementation blueprint for the `ai-service` — a Python FastAPI backend providing **two AI modes** for the CEW Solar Construction App:

| Mode | Purpose | Data Source | AI Task |
|------|---------|-------------|---------|
| **`general`** | Answer technical questions from documents | ChromaDB (RAG) | Retrieval + LLM synthesis |
| **`progress`** | Analyze construction progress data | `mock_db.py` | Pandas analysis + LLM summary |

### Core Constraints (Non-Negotiable)
- ✅ **LLM:** OpenAI `gpt-4o-mini`
- ✅ **Embeddings:** OpenAI `text-embedding-3-small`
- ✅ **Vector DB:** ChromaDB (local persistence)
- ✅ **No Hallucination:** Explicit fallback if answer not found
- ✅ **Bilingual:** Detect user language (EN/TR) and respond accordingly
- ✅ **Stateless:** Each query is standalone (no conversation memory)
- ✅ **No Auth:** MVP runs locally, no authentication

---

## 2. ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CEW1 FRONTEND (React)                            │
│                         http://localhost:5173                            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 │  POST /api/query  { question, mode }
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI-SERVICE (FastAPI)                             │
│                         http://localhost:8000                            │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      QUERY ROUTER                                   │ │
│  │   mode == "general"  ───────────────────▶  RAG Pipeline            │ │
│  │   mode == "progress" ───────────────────▶  Data Pipeline           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌──────────────────────────┐    ┌──────────────────────────────────┐  │
│  │     RAG PIPELINE         │    │      DATA PIPELINE               │  │
│  │                          │    │                                  │  │
│  │  1. Embed question       │    │  1. Parse question               │  │
│  │  2. Search ChromaDB      │    │  2. Query mock_db.py             │  │
│  │  3. Build prompt         │    │  3. Pandas analysis              │  │
│  │  4. Call gpt-4o-mini     │    │  4. Build prompt with results    │  │
│  │  5. Return answer+source │    │  5. Call gpt-4o-mini             │  │
│  └──────────────────────────┘    │  6. Return answer                │  │
│              │                   └──────────────────────────────────┘  │
│              │                                    │                     │
│              ▼                                    ▼                     │
│  ┌──────────────────────────┐    ┌──────────────────────────────────┐  │
│  │     ChromaDB (Local)     │    │      mock_db.py                  │  │
│  │     ./chroma_db/         │    │      (In-memory data)            │  │
│  └──────────────────────────┘    └──────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      INGEST SCRIPT                                  │ │
│  │   python ingest.py                                                  │ │
│  │   → Parse PDF/XLSX/DOCX from ./documents/                           │ │
│  │   → Chunk text                                                      │ │
│  │   → Embed with text-embedding-3-small                               │ │
│  │   → Store in ChromaDB                                               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. FOLDER STRUCTURE

```
ai-service/
├── app/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app entry point
│   ├── config.py                  # Environment & settings
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── query.py               # POST /api/query endpoint
│   │   └── health.py              # GET /health endpoint
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── rag_service.py         # RAG pipeline (general mode)
│   │   ├── data_service.py        # Data analysis pipeline (progress mode)
│   │   ├── llm_service.py         # OpenAI LLM wrapper
│   │   ├── embedding_service.py   # OpenAI embeddings wrapper
│   │   └── chroma_service.py      # ChromaDB operations
│   │
│   ├── prompts/
│   │   ├── __init__.py
│   │   ├── system_general.txt     # System prompt for RAG mode
│   │   ├── system_progress.txt    # System prompt for data mode
│   │   └── fallback.txt           # Fallback response template
│   │
│   └── utils/
│       ├── __init__.py
│       ├── language_detect.py     # Detect EN/TR language
│       └── text_utils.py          # Text processing helpers
│
├── data/
│   └── mock_db.py                 # Mock progress data (list of dicts)
│
├── documents/                     # Place PDFs, XLSX, DOCX here
│   └── (user places files here)
│
├── scripts/
│   └── ingest.py                  # One-time ingestion script
│
├── chroma_db/                     # ChromaDB persistent storage (auto-created)
│
├── tests/
│   ├── __init__.py
│   ├── test_query.py
│   └── test_ingest.py
│
├── .env.example                   # Environment variable template
├── .gitignore
├── requirements.txt               # Python dependencies
├── README.md                      # Quick start guide
└── Implementation_Plan.md         # This document
```

---

## 4. DATA SCHEMAS

### 4.1 Progress Data Schema (`mock_db.py`)

```python
# data/mock_db.py

PROGRESS_DATA = [
    {
        "date": "2026-01-05",
        "subcontractor_code": "SUB-A",
        "worker_count": 12,
        "amount_done": 450.5,
        "unit": "meters"
    },
    {
        "date": "2026-01-05",
        "subcontractor_code": "SUB-B",
        "worker_count": 8,
        "amount_done": 320.0,
        "unit": "meters"
    },
    {
        "date": "2026-01-06",
        "subcontractor_code": "SUB-A",
        "worker_count": 15,
        "amount_done": 580.0,
        "unit": "meters"
    },
    # ... more records
]

def get_all_progress():
    """Return all progress records as list of dicts."""
    return PROGRESS_DATA
```

**Schema Definition:**

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `date` | `str` | ISO date format | `"2026-01-05"` |
| `subcontractor_code` | `str` | Subcontractor identifier | `"SUB-A"` |
| `worker_count` | `int` | Number of workers | `12` |
| `amount_done` | `float` | Work completed | `450.5` |
| `unit` | `str` | Unit of measurement | `"meters"` |

---

### 4.2 API Request/Response Schemas

#### Request: `POST /api/query`

```json
{
  "question": "What is the minimum trench depth?",
  "mode": "general"
}
```

| Field | Type | Required | Values | Description |
|-------|------|----------|--------|-------------|
| `question` | `str` | ✅ | Any text | User's natural language question |
| `mode` | `str` | ✅ | `"general"` or `"progress"` | Which pipeline to use |

#### Response: Success

```json
{
  "answer": "The minimum trench depth is 800mm according to the specifications.",
  "source": "Technical Description_Rev01.docx (Section 3.2)"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `answer` | `str` | AI-generated answer |
| `source` | `str` | Document reference (RAG) or `"CEW Progress Database"` (data) |

#### Response: Fallback (No Answer Found)

```json
{
  "answer": "I cannot find this information in the provided records/documents.",
  "source": null
}
```

---

## 5. FILE-BY-FILE IMPLEMENTATION SPEC

### 5.1 `app/main.py` — FastAPI Entry Point

```python
"""
FastAPI application entry point.
Registers routers and configures CORS for CEW1 frontend.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import query, health

app = FastAPI(
    title="CEW AI Service",
    version="1.0.0",
    description="AI backend for CEW Solar Construction App"
)

# CORS for local development (CEW1 frontend at localhost:5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(health.router)
app.include_router(query.router, prefix="/api")
```

---

### 5.2 `app/config.py` — Configuration

```python
"""
Application configuration.
Load from environment variables with sensible defaults.
"""
import os
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).parent.parent
DOCUMENTS_DIR = BASE_DIR / "documents"
CHROMA_DIR = BASE_DIR / "chroma_db"

# OpenAI
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
LLM_MODEL = "gpt-4o-mini"
EMBEDDING_MODEL = "text-embedding-3-small"

# ChromaDB
CHROMA_COLLECTION_NAME = "cew_documents"

# RAG settings
CHUNK_SIZE = 500          # tokens per chunk
CHUNK_OVERLAP = 50        # overlap between chunks
TOP_K_RESULTS = 5         # number of chunks to retrieve
SIMILARITY_THRESHOLD = 0.7

# Server
HOST = "0.0.0.0"
PORT = 8000
```

---

### 5.3 `app/routers/query.py` — Query Endpoint

```python
"""
POST /api/query endpoint.
Routes to RAG or Data pipeline based on mode.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.rag_service import process_rag_query
from app.services.data_service import process_data_query

router = APIRouter()

class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    mode: str = Field(..., pattern="^(general|progress)$")

class QueryResponse(BaseModel):
    answer: str
    source: str | None

@router.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    """
    Process a user question in either 'general' (RAG) or 'progress' (data) mode.
    """
    if request.mode == "general":
        result = await process_rag_query(request.question)
    elif request.mode == "progress":
        result = await process_data_query(request.question)
    else:
        raise HTTPException(status_code=400, detail="Invalid mode")
    
    return QueryResponse(
        answer=result["answer"],
        source=result.get("source")
    )
```

---

### 5.4 `app/services/rag_service.py` — RAG Pipeline

```python
"""
RAG (Retrieval-Augmented Generation) pipeline for 'general' mode.
"""
from app.services.embedding_service import generate_embedding
from app.services.chroma_service import search_documents
from app.services.llm_service import generate_answer
from app.utils.language_detect import detect_language
from app.prompts import load_prompt

FALLBACK_MESSAGE_EN = "I cannot find this information in the provided documents."
FALLBACK_MESSAGE_TR = "Bu bilgiyi mevcut belgelerde bulamıyorum."

async def process_rag_query(question: str) -> dict:
    """
    1. Detect language
    2. Generate embedding for question
    3. Search ChromaDB for relevant chunks
    4. If no results, return fallback
    5. Build prompt with chunks
    6. Call LLM
    7. Return answer with source
    """
    # Step 1: Detect language
    language = detect_language(question)
    fallback = FALLBACK_MESSAGE_TR if language == "tr" else FALLBACK_MESSAGE_EN
    
    # Step 2: Generate embedding
    query_embedding = await generate_embedding(question)
    
    # Step 3: Search ChromaDB
    results = search_documents(query_embedding, top_k=5)
    
    # Step 4: Check if results are relevant
    if not results or results[0]["score"] < 0.7:
        return {"answer": fallback, "source": None}
    
    # Step 5: Build prompt
    system_prompt = load_prompt("system_general.txt", language=language)
    context = "\n\n".join([
        f"[Source: {r['metadata']['doc_name']} | Page: {r['metadata'].get('page', 'N/A')}]\n{r['text']}"
        for r in results
    ])
    
    user_prompt = f"""QUESTION:
{question}

RELEVANT DOCUMENT EXCERPTS:
{context}

Answer the question using ONLY the information above. Cite the source."""
    
    # Step 6: Call LLM
    answer = await generate_answer(system_prompt, user_prompt)
    
    # Step 7: Extract source (first result)
    source = f"{results[0]['metadata']['doc_name']}"
    if results[0]['metadata'].get('page'):
        source += f" (Page {results[0]['metadata']['page']})"
    
    return {"answer": answer, "source": source}
```

---

### 5.5 `app/services/data_service.py` — Data Analysis Pipeline

```python
"""
Data analysis pipeline for 'progress' mode.
Uses Pandas to analyze mock_db.py data.
"""
import pandas as pd

from data.mock_db import get_all_progress
from app.services.llm_service import generate_answer
from app.utils.language_detect import detect_language
from app.prompts import load_prompt

FALLBACK_MESSAGE_EN = "I cannot find this information in the provided records."
FALLBACK_MESSAGE_TR = "Bu bilgiyi mevcut kayıtlarda bulamıyorum."

async def process_data_query(question: str) -> dict:
    """
    1. Load progress data into Pandas DataFrame
    2. Detect language
    3. Build prompt with data summary
    4. Call LLM to generate analysis
    5. Return answer
    """
    # Step 1: Load data
    data = get_all_progress()
    df = pd.DataFrame(data)
    
    if df.empty:
        language = detect_language(question)
        fallback = FALLBACK_MESSAGE_TR if language == "tr" else FALLBACK_MESSAGE_EN
        return {"answer": fallback, "source": None}
    
    # Step 2: Detect language
    language = detect_language(question)
    
    # Step 3: Prepare data summary for LLM
    data_summary = f"""
DATA SCHEMA:
- date: Work date (YYYY-MM-DD)
- subcontractor_code: Subcontractor identifier
- worker_count: Number of workers
- amount_done: Work completed
- unit: Unit of measurement

AVAILABLE DATA (first 20 rows):
{df.head(20).to_string(index=False)}

STATISTICS:
- Total records: {len(df)}
- Date range: {df['date'].min()} to {df['date'].max()}
- Subcontractors: {', '.join(df['subcontractor_code'].unique())}
- Total amount done: {df['amount_done'].sum():.2f}
- Average workers per day: {df['worker_count'].mean():.1f}

FULL DATA AS JSON:
{df.to_json(orient='records')}
"""
    
    # Step 4: Build prompt
    system_prompt = load_prompt("system_progress.txt", language=language)
    
    user_prompt = f"""QUESTION:
{question}

AVAILABLE DATA:
{data_summary}

Analyze the data and answer the question. Be specific with numbers. If the data doesn't contain the answer, say so."""
    
    # Step 5: Call LLM
    answer = await generate_answer(system_prompt, user_prompt)
    
    return {"answer": answer, "source": "CEW Progress Database"}
```

---

### 5.6 `app/services/llm_service.py` — OpenAI LLM Wrapper

```python
"""
OpenAI LLM service wrapper.
"""
from openai import AsyncOpenAI

from app.config import OPENAI_API_KEY, LLM_MODEL

client = AsyncOpenAI(api_key=OPENAI_API_KEY)

async def generate_answer(system_prompt: str, user_prompt: str) -> str:
    """
    Call OpenAI chat completion with system + user prompts.
    Temperature 0 for deterministic, factual responses.
    """
    response = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.0,
        max_tokens=1000
    )
    
    return response.choices[0].message.content
```

---

### 5.7 `app/services/embedding_service.py` — OpenAI Embeddings Wrapper

```python
"""
OpenAI embeddings service wrapper.
"""
from openai import AsyncOpenAI

from app.config import OPENAI_API_KEY, EMBEDDING_MODEL

client = AsyncOpenAI(api_key=OPENAI_API_KEY)

async def generate_embedding(text: str) -> list[float]:
    """
    Generate embedding vector for text using OpenAI.
    """
    response = await client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text
    )
    
    return response.data[0].embedding

def generate_embedding_sync(text: str) -> list[float]:
    """
    Synchronous version for ingest script.
    """
    from openai import OpenAI
    sync_client = OpenAI(api_key=OPENAI_API_KEY)
    
    response = sync_client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text
    )
    
    return response.data[0].embedding
```

---

### 5.8 `app/services/chroma_service.py` — ChromaDB Operations

```python
"""
ChromaDB service for vector storage and retrieval.
"""
import chromadb
from chromadb.config import Settings

from app.config import CHROMA_DIR, CHROMA_COLLECTION_NAME

# Initialize ChromaDB with persistent storage
chroma_client = chromadb.PersistentClient(
    path=str(CHROMA_DIR),
    settings=Settings(anonymized_telemetry=False)
)

def get_collection():
    """Get or create the documents collection."""
    return chroma_client.get_or_create_collection(
        name=CHROMA_COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}
    )

def search_documents(query_embedding: list[float], top_k: int = 5) -> list[dict]:
    """
    Search for similar documents using embedding.
    Returns list of results with text, metadata, and similarity score.
    """
    collection = get_collection()
    
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"]
    )
    
    if not results["ids"][0]:
        return []
    
    # Convert distances to similarity scores (cosine: 1 - distance)
    output = []
    for i, doc_id in enumerate(results["ids"][0]):
        output.append({
            "id": doc_id,
            "text": results["documents"][0][i],
            "metadata": results["metadatas"][0][i],
            "score": 1 - results["distances"][0][i]  # Convert distance to similarity
        })
    
    return output

def add_documents(documents: list[dict]):
    """
    Add documents to ChromaDB.
    Each document: {id, text, embedding, metadata}
    """
    collection = get_collection()
    
    collection.add(
        ids=[doc["id"] for doc in documents],
        documents=[doc["text"] for doc in documents],
        embeddings=[doc["embedding"] for doc in documents],
        metadatas=[doc["metadata"] for doc in documents]
    )

def clear_collection():
    """Delete and recreate collection (for re-ingestion)."""
    try:
        chroma_client.delete_collection(CHROMA_COLLECTION_NAME)
    except:
        pass
    return get_collection()
```

---

### 5.9 `app/prompts/__init__.py` — Prompt Loader

```python
"""
Prompt loading utilities.
"""
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent

def load_prompt(filename: str, language: str = "en") -> str:
    """Load prompt from file, with language substitution."""
    filepath = PROMPTS_DIR / filename
    
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Replace language placeholder
    if language == "tr":
        content = content.replace("{{LANGUAGE}}", "Turkish")
    else:
        content = content.replace("{{LANGUAGE}}", "English")
    
    return content
```

---

### 5.10 `app/prompts/system_general.txt`

```
You are a technical assistant for construction engineers working on a solar farm project.

STRICT RULES:
1. Answer ONLY using the provided document excerpts below.
2. Do NOT use your general knowledge.
3. Do NOT guess, infer, or extrapolate.
4. If the answer is not explicitly stated in the excerpts, respond with:
   - English: "I cannot find this information in the provided documents."
   - Turkish: "Bu bilgiyi mevcut belgelerde bulamıyorum."
5. ALWAYS cite the source document name for every statement.
6. Answer in {{LANGUAGE}}.
7. Be concise and direct.
8. Do NOT make compliance or approval claims.
```

---

### 5.11 `app/prompts/system_progress.txt`

```
You are a data analyst assistant for a solar farm construction project.

STRICT RULES:
1. Analyze ONLY the provided progress data.
2. Use specific numbers from the data in your answers.
3. If the data doesn't contain information to answer the question, say:
   - English: "I cannot find this information in the provided records."
   - Turkish: "Bu bilgiyi mevcut kayıtlarda bulamıyorum."
4. Answer in {{LANGUAGE}}.
5. Be precise with calculations (sums, averages, counts).
6. Format numbers clearly (use commas for thousands, 2 decimal places).
7. When comparing subcontractors, be objective and factual.
```

---

### 5.12 `app/utils/language_detect.py` — Language Detection

```python
"""
Simple language detection for EN/TR.
"""
import re

# Common Turkish words/patterns
TURKISH_PATTERNS = [
    r'\b(ve|veya|için|ile|bu|bir|olan|olarak|da|de|mi|mı|ne|nasıl|neden|kaç|toplam)\b',
    r'[şŞğĞüÜçÇöÖıİ]',  # Turkish-specific characters
]

def detect_language(text: str) -> str:
    """
    Detect if text is Turkish or English.
    Returns 'tr' or 'en'.
    """
    text_lower = text.lower()
    
    # Check for Turkish patterns
    for pattern in TURKISH_PATTERNS:
        if re.search(pattern, text_lower):
            return "tr"
    
    return "en"
```

---

### 5.13 `scripts/ingest.py` — Document Ingestion Script

```python
#!/usr/bin/env python3
"""
Document ingestion script.
Run once to process documents from ./documents/ folder into ChromaDB.

Usage:
    python scripts/ingest.py
"""
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import DOCUMENTS_DIR, CHUNK_SIZE, CHUNK_OVERLAP
from app.services.embedding_service import generate_embedding_sync
from app.services.chroma_service import add_documents, clear_collection

# Document parsers
import fitz  # PyMuPDF for PDF
import openpyxl  # Excel
from docx import Document  # Word


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into overlapping chunks by words."""
    words = text.split()
    chunks = []
    
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i:i + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
    
    return chunks


def parse_pdf(filepath: Path) -> list[dict]:
    """Extract text from PDF, return list of {page, text}."""
    doc = fitz.open(filepath)
    pages = []
    
    for page_num, page in enumerate(doc, start=1):
        text = page.get_text().strip()
        if text:
            pages.append({"page": page_num, "text": text})
    
    doc.close()
    return pages


def parse_xlsx(filepath: Path) -> list[dict]:
    """Extract text from Excel, return list of {sheet, text}."""
    wb = openpyxl.load_workbook(filepath, data_only=True)
    sheets = []
    
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = []
        for row in ws.iter_rows(values_only=True):
            row_text = " | ".join([str(cell) for cell in row if cell is not None])
            if row_text.strip():
                rows.append(row_text)
        
        if rows:
            sheets.append({"sheet": sheet_name, "text": "\n".join(rows)})
    
    return sheets


def parse_docx(filepath: Path) -> list[dict]:
    """Extract text from Word document."""
    doc = Document(filepath)
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    
    return [{"page": 1, "text": "\n\n".join(paragraphs)}]


def ingest_documents():
    """Main ingestion function."""
    print("=" * 60)
    print("CEW AI-SERVICE — DOCUMENT INGESTION")
    print("=" * 60)
    
    # Clear existing collection
    print("\n[1/4] Clearing existing ChromaDB collection...")
    clear_collection()
    
    # Find all documents
    print(f"\n[2/4] Scanning {DOCUMENTS_DIR} for documents...")
    
    supported_extensions = {".pdf", ".xlsx", ".xls", ".docx"}
    files = [f for f in DOCUMENTS_DIR.iterdir() if f.suffix.lower() in supported_extensions]
    
    if not files:
        print(f"⚠️  No documents found in {DOCUMENTS_DIR}")
        print(f"   Place PDF, XLSX, or DOCX files there and re-run.")
        return
    
    print(f"   Found {len(files)} documents:")
    for f in files:
        print(f"   - {f.name}")
    
    # Process each document
    print(f"\n[3/4] Processing documents...")
    all_chunks = []
    
    for file in files:
        print(f"\n   Processing: {file.name}")
        
        try:
            if file.suffix.lower() == ".pdf":
                pages = parse_pdf(file)
                for page_data in pages:
                    chunks = chunk_text(page_data["text"], CHUNK_SIZE, CHUNK_OVERLAP)
                    for i, chunk in enumerate(chunks):
                        all_chunks.append({
                            "doc_name": file.name,
                            "page": page_data["page"],
                            "chunk_index": i,
                            "text": chunk
                        })
                print(f"      ✓ {len(pages)} pages, {sum(len(chunk_text(p['text'])) for p in pages)} chunks")
                
            elif file.suffix.lower() in {".xlsx", ".xls"}:
                sheets = parse_xlsx(file)
                for sheet_data in sheets:
                    chunks = chunk_text(sheet_data["text"], CHUNK_SIZE, CHUNK_OVERLAP)
                    for i, chunk in enumerate(chunks):
                        all_chunks.append({
                            "doc_name": file.name,
                            "sheet": sheet_data["sheet"],
                            "chunk_index": i,
                            "text": chunk
                        })
                print(f"      ✓ {len(sheets)} sheets")
                
            elif file.suffix.lower() == ".docx":
                pages = parse_docx(file)
                for page_data in pages:
                    chunks = chunk_text(page_data["text"], CHUNK_SIZE, CHUNK_OVERLAP)
                    for i, chunk in enumerate(chunks):
                        all_chunks.append({
                            "doc_name": file.name,
                            "page": page_data.get("page", 1),
                            "chunk_index": i,
                            "text": chunk
                        })
                print(f"      ✓ {len(chunks)} chunks")
                
        except Exception as e:
            print(f"      ✗ Error: {e}")
    
    print(f"\n   Total chunks to embed: {len(all_chunks)}")
    
    # Generate embeddings and store
    print(f"\n[4/4] Generating embeddings and storing in ChromaDB...")
    
    documents = []
    for i, chunk in enumerate(all_chunks):
        if (i + 1) % 10 == 0 or i == 0:
            print(f"      Processing chunk {i + 1}/{len(all_chunks)}...")
        
        embedding = generate_embedding_sync(chunk["text"])
        
        doc_id = f"{chunk['doc_name']}_{chunk.get('page', chunk.get('sheet', 0))}_{chunk['chunk_index']}"
        
        documents.append({
            "id": doc_id,
            "text": chunk["text"],
            "embedding": embedding,
            "metadata": {
                "doc_name": chunk["doc_name"],
                "page": chunk.get("page"),
                "sheet": chunk.get("sheet"),
                "chunk_index": chunk["chunk_index"]
            }
        })
    
    # Batch add to ChromaDB
    add_documents(documents)
    
    print(f"\n" + "=" * 60)
    print(f"✅ INGESTION COMPLETE")
    print(f"   Documents: {len(files)}")
    print(f"   Chunks: {len(documents)}")
    print(f"=" * 60)


if __name__ == "__main__":
    ingest_documents()
```

---

### 5.14 `data/mock_db.py` — Mock Progress Data

```python
"""
Mock database for progress data.
In production, this would query a real database.
"""

PROGRESS_DATA = [
    # SUB-A: DC Cable Pulling
    {"date": "2026-01-03", "subcontractor_code": "SUB-A", "worker_count": 10, "amount_done": 320.5, "unit": "meters"},
    {"date": "2026-01-04", "subcontractor_code": "SUB-A", "worker_count": 12, "amount_done": 410.0, "unit": "meters"},
    {"date": "2026-01-05", "subcontractor_code": "SUB-A", "worker_count": 12, "amount_done": 450.5, "unit": "meters"},
    {"date": "2026-01-06", "subcontractor_code": "SUB-A", "worker_count": 15, "amount_done": 580.0, "unit": "meters"},
    {"date": "2026-01-07", "subcontractor_code": "SUB-A", "worker_count": 14, "amount_done": 520.0, "unit": "meters"},
    {"date": "2026-01-08", "subcontractor_code": "SUB-A", "worker_count": 11, "amount_done": 390.0, "unit": "meters"},
    {"date": "2026-01-09", "subcontractor_code": "SUB-A", "worker_count": 13, "amount_done": 480.0, "unit": "meters"},
    
    # SUB-B: MV Cable Pulling
    {"date": "2026-01-03", "subcontractor_code": "SUB-B", "worker_count": 8, "amount_done": 150.0, "unit": "meters"},
    {"date": "2026-01-04", "subcontractor_code": "SUB-B", "worker_count": 8, "amount_done": 180.0, "unit": "meters"},
    {"date": "2026-01-05", "subcontractor_code": "SUB-B", "worker_count": 10, "amount_done": 220.0, "unit": "meters"},
    {"date": "2026-01-06", "subcontractor_code": "SUB-B", "worker_count": 10, "amount_done": 240.0, "unit": "meters"},
    {"date": "2026-01-07", "subcontractor_code": "SUB-B", "worker_count": 9, "amount_done": 200.0, "unit": "meters"},
    {"date": "2026-01-08", "subcontractor_code": "SUB-B", "worker_count": 11, "amount_done": 260.0, "unit": "meters"},
    {"date": "2026-01-09", "subcontractor_code": "SUB-B", "worker_count": 10, "amount_done": 230.0, "unit": "meters"},
    
    # SUB-C: Trenching
    {"date": "2026-01-03", "subcontractor_code": "SUB-C", "worker_count": 20, "amount_done": 85.5, "unit": "cubic_meters"},
    {"date": "2026-01-04", "subcontractor_code": "SUB-C", "worker_count": 22, "amount_done": 95.0, "unit": "cubic_meters"},
    {"date": "2026-01-05", "subcontractor_code": "SUB-C", "worker_count": 18, "amount_done": 72.0, "unit": "cubic_meters"},
    {"date": "2026-01-06", "subcontractor_code": "SUB-C", "worker_count": 25, "amount_done": 110.0, "unit": "cubic_meters"},
    {"date": "2026-01-07", "subcontractor_code": "SUB-C", "worker_count": 24, "amount_done": 105.0, "unit": "cubic_meters"},
    {"date": "2026-01-08", "subcontractor_code": "SUB-C", "worker_count": 20, "amount_done": 88.0, "unit": "cubic_meters"},
    {"date": "2026-01-09", "subcontractor_code": "SUB-C", "worker_count": 23, "amount_done": 98.0, "unit": "cubic_meters"},
]


def get_all_progress() -> list[dict]:
    """Return all progress records."""
    return PROGRESS_DATA


def get_progress_by_subcontractor(code: str) -> list[dict]:
    """Return progress for a specific subcontractor."""
    return [r for r in PROGRESS_DATA if r["subcontractor_code"] == code]


def get_progress_by_date_range(start: str, end: str) -> list[dict]:
    """Return progress within a date range."""
    return [r for r in PROGRESS_DATA if start <= r["date"] <= end]
```

---

### 5.15 `requirements.txt`

```
# FastAPI & Server
fastapi==0.109.0
uvicorn[standard]==0.27.0
pydantic==2.5.3

# OpenAI
openai==1.12.0

# Vector Database
chromadb==0.4.22

# Document Parsing
PyMuPDF==1.23.8      # PDF
openpyxl==3.1.2      # Excel
python-docx==1.1.0   # Word

# Data Analysis
pandas==2.2.0

# Utilities
python-dotenv==1.0.0

# Testing
pytest==7.4.4
pytest-asyncio==0.23.3
httpx==0.26.0
```

---

### 5.16 `.env.example`

```env
# OpenAI API Key (required)
OPENAI_API_KEY=sk-your-key-here

# Server Settings (optional)
HOST=0.0.0.0
PORT=8000
```

---

## 6. IMPLEMENTATION ORDER (Step-by-Step)

| Step | Task | Files | Time |
|------|------|-------|------|
| **1** | Create folder structure | All directories | 5 min |
| **2** | Setup dependencies | `requirements.txt`, `.env.example` | 10 min |
| **3** | Implement config | `app/config.py` | 5 min |
| **4** | Implement utilities | `app/utils/` | 10 min |
| **5** | Implement prompts | `app/prompts/` | 10 min |
| **6** | Implement services | `app/services/` | 30 min |
| **7** | Implement routers | `app/routers/` | 15 min |
| **8** | Implement main app | `app/main.py` | 5 min |
| **9** | Create mock data | `data/mock_db.py` | 5 min |
| **10** | Implement ingest script | `scripts/ingest.py` | 20 min |
| **11** | Test with documents | Manual testing | 15 min |
| **12** | Write README | `README.md` | 10 min |

**Total Estimated Time: ~2-3 hours**

---

## 7. STARTUP COMMANDS

### First-Time Setup

```powershell
# 1. Navigate to ai-service
cd C:\Users\atila\CEW\ai-service

# 2. Create virtual environment
python -m venv venv

# 3. Activate virtual environment
.\venv\Scripts\Activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Create .env file with your API key
copy .env.example .env
# Edit .env and add your OPENAI_API_KEY

# 6. Place documents in ./documents/ folder
# (Copy your PDFs, XLSX, DOCX files there)

# 7. Run ingestion script
python scripts/ingest.py

# 8. Start the server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Daily Startup (After Setup)

```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

## 8. API TESTING EXAMPLES

### Test Health Endpoint

```bash
curl http://localhost:8000/health
```

**Response:**
```json
{"status": "healthy", "version": "1.0.0"}
```

### Test General Mode (RAG)

```bash
curl -X POST http://localhost:8000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the minimum trench depth?", "mode": "general"}'
```

**Response:**
```json
{
  "answer": "According to the Technical Description, the minimum trench depth is 800mm from finished ground level.",
  "source": "Technical Description_Rev01.docx (Page 5)"
}
```

### Test Progress Mode (Data Analysis)

```bash
curl -X POST http://localhost:8000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the total amount done by SUB-A?", "mode": "progress"}'
```

**Response:**
```json
{
  "answer": "The total amount done by SUB-A (DC Cable Pulling) is 3,151.0 meters across 7 work days, with an average of 450.14 meters per day.",
  "source": "CEW Progress Database"
}
```

### Test Turkish Language

```bash
curl -X POST http://localhost:8000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "SUB-B toplam ne kadar iş yaptı?", "mode": "progress"}'
```

**Response:**
```json
{
  "answer": "SUB-B (MV Kablo Çekimi) toplam 1,480.0 metre iş tamamlamıştır. Günlük ortalama 211.43 metredir.",
  "source": "CEW Progress Database"
}
```

---

## 9. EDGE CASES & ERROR HANDLING

| Scenario | Expected Behavior |
|----------|-------------------|
| Empty question | Return 422 validation error |
| Invalid mode | Return 422 validation error |
| No documents in ChromaDB | Return fallback message |
| Low similarity score (<0.7) | Return fallback message |
| OpenAI API error | Return 500 with error details |
| Empty mock_db | Return fallback message |
| Turkish question | Detect language, respond in Turkish |
| Very long question (>1000 chars) | Return 422 validation error |

---

## 10. SECURITY NOTES (MVP)

| Item | MVP Status | Production TODO |
|------|------------|-----------------|
| Authentication | ❌ None | Add JWT/API Key |
| HTTPS | ❌ HTTP only | Add SSL/TLS |
| Rate Limiting | ❌ None | Add per-IP limits |
| Input Sanitization | ✅ Pydantic validation | Add more checks |
| API Key Storage | ✅ .env file | Use secrets manager |
| CORS | ✅ Localhost only | Restrict to prod domain |

---

## 11. NEXT STEPS AFTER MVP

1. **Add Authentication** — JWT tokens or API keys
2. **Real Database** — Replace `mock_db.py` with Supabase/PostgreSQL
3. **Streaming Responses** — For long answers
4. **Document Upload API** — Instead of file system
5. **Frontend Integration** — Connect CEW1 to this API
6. **Deployment** — Docker + Cloud hosting

---

**END OF IMPLEMENTATION PLAN**

*This document is the single source of truth for the ai-service MVP.*
