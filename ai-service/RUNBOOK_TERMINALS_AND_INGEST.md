# CEW AI-Service Runbook (Terminals + Ingest)

This runbook explains **how many terminals you need**, **which commands to run**, and **how to run ingestion** safely.

## 0) Prerequisites (one-time)
- Python venv exists at `ai-service/venv/`
- `ai-service/.env` exists and contains `OPENAI_API_KEY=...`

## 1) How many terminals do I need?

### Minimum: 1 terminal
You can run **either** ingestion **or** the API server at a time.

### Recommended: 2 terminals
- **Terminal A**: AI backend server (FastAPI/uvicorn)
- **Terminal B**: Ingestion + benchmarks + diagnostics

### Optional: 3 terminals (if you run the frontend)
- **Terminal C**: Frontend dev server (`CEW1/_root`)

## 2) Terminal A — Run the AI backend (API server)

```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health check:
```powershell
curl http://localhost:8000/health
```

## 3) Terminal B — Run ingestion (index documents into ChromaDB)

### 3.1 Add documents
Put your files here:
- `ai-service/documents/`

Supported:
- `.docx`
- `.pdf` (text PDFs supported; scan/drawing PDFs may produce limited results without OCR)
- `.xlsx` / `.xls`

### 3.2 (Recommended) Full re-index (clean)
Use this when you added/removed many documents or want a clean rebuild:

```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
Remove-Item -Recurse -Force chroma_db -ErrorAction SilentlyContinue
python scripts/ingest.py
```

### 3.3 Incremental ingest (recommended for daily use)
Use this when you only added/changed a few documents and want a fast update.

What it does:
- Computes a sha256 hash per file
- Only ingests new/changed files
- Keeps a manifest inside `chroma_db/` so it stays tied to the current index

```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
python scripts/ingest_incremental.py
```

If you also deleted a document from `documents/` and want it removed from Chroma:

```powershell
python scripts/ingest_incremental.py --prune-removed
```

Preview what would happen (no writes):

```powershell
python scripts/ingest_incremental.py --dry-run --prune-removed
```

When to prefer full rebuild (`scripts/ingest.py`):
- You changed chunking/embedding config
- You changed parsing logic significantly
- You suspect the index is inconsistent

## 4) Quick verification after ingest

```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
python scripts/inspect_db.py -n 10
```

Expected:
- Collection count is **> 0**
- Chunks look like structured rows:
  - `SOURCE: ... | TABLE: ... | ROW: ... | DATA: ...`

## 5) Benchmarks (optional but recommended)

### 5.1 Single-doc benchmark (if you’re isolating a document)
```powershell
python scripts/build_golden_from_chroma.py --doc "Technical Description_Rev01.docx" --max-tests 80
python scripts/benchmark_td_rev01.py --timeout 120
```

### 5.2 Smart logic benchmark (typos, ambiguity, citations)
```powershell
python scripts/benchmark_smart_logic.py
```

## 6) Terminal C — Run the frontend (optional)

```powershell
cd C:\Users\atila\CEW\CEW1\_root
npm install
npm run dev
```

Frontend default:
- `http://localhost:5173`

## 7) Common issues

### 7.1 Ingest says OPENAI_API_KEY missing
- Ensure `ai-service/.env` exists and contains:
  - `OPENAI_API_KEY=...`
- Ensure `.env` is **UTF-8 without BOM** (BOM can break key parsing).

### 7.2 PDF is drawing/scanned and answers are missing
Without OCR:
- It’s expected some drawing/scanned PDFs will not yield extractable text.
- The system should return fallback rather than guessing.

### 7.3 “UnicodeEncodeError” on Windows
This repo includes UTF-8 stdout fixes for:
- `ai-service/app/main.py` (server)
- `ai-service/scripts/ingest.py` (ingestion)

If you still see it:
- Run PowerShell / terminal with UTF-8 output support
- Avoid printing non-ASCII characters in custom scripts

