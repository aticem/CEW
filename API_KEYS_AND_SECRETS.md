# API Keys & Secrets (CEW Repo)

This document lists **which API keys/secrets are used**, **where they are loaded**, and **how to configure them safely**.

## Summary

### ai-service (Python / FastAPI)
- **OPENAI_API_KEY**: **Required** for:
  - document ingestion embeddings (Chroma indexing)
  - query-time embeddings (RAG retrieval)
  - LLM chat completions (answer generation)

### CEW1/_root (React / Vite frontend)
- **No API keys** should exist in the frontend.  
  The frontend calls the backend over HTTP and must **not** contain LLM keys.

## 1) `OPENAI_API_KEY`

### What it is used for
- **Embeddings (ingest-time)**:
  - Script: `ai-service/scripts/ingest.py`
  - Calls: `ai-service/app/services/embedding_service.py` (`generate_embedding_sync`)
- **Embeddings (query-time)**:
  - RAG: `ai-service/app/services/rag_service.py` (`generate_embedding`)
- **LLM answers (query-time)**:
  - LLM: `ai-service/app/services/llm_service.py` (`AsyncOpenAI(...).chat.completions.create(...)`)

### Where it is configured
- File: `ai-service/.env` (gitignored)
- Loader: `ai-service/app/config.py`
  - Loads `.env` via `python-dotenv` using a stable path (not dependent on current working directory).

### How to set it
Create/edit `ai-service/.env`:
```env
OPENAI_API_KEY=sk-...
```

Optional knobs (also in `.env`):
```env
LLM_MODEL=gpt-4o
EMBEDDING_MODEL=text-embedding-3-small
HOST=0.0.0.0
PORT=8000
```

### Security rules
- **Never commit `.env`**:
  - `ai-service/.gitignore` includes `.env`
- **Never put `OPENAI_API_KEY` into frontend code** (React/Vite).
- If a key is ever pasted into chat/logs, **rotate it immediately** in your OpenAI dashboard.

## 2) Docker / deployment notes

If you use Docker Compose:
- File: `docker-compose.yml` references an env file:
  - `./ai-service/.env`
- Keep that `.env` on the host and mount/read it at runtime; do not bake keys into images.

## 3) “Telemetry event capture()…” warnings

You may see warnings like:
`Failed to send telemetry event ... capture() takes 1 positional argument but 3 were given`

These warnings are **not API key related**. They come from Chroma/telemetry internals and do not affect key loading.

## 4) Quick validation checklist

From PowerShell:
```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
python -c "from app.config import OPENAI_API_KEY; print(bool(OPENAI_API_KEY), len(OPENAI_API_KEY or ''))"
```

Expected output:
- `True` and a non-zero length

