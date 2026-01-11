# CEW AI-Service Benchmark (Technical Description_Rev01.docx)

## Goal
Maximize RAG **recall** (\"dokümanda olanı neredeyse hiç kaçırmasın\") while staying inside CEW guardrails:
- No hallucination / no guessing
- If not explicitly in context → return fallback
- Every factual claim must include citation in brackets

This benchmark isolates a single document to avoid false passes caused by other files.

## Blocking requirement
Ingestion requires embeddings, therefore `OPENAI_API_KEY` must be set.

Create `ai-service/.env`:
```env
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o
EMBEDDING_MODEL=text-embedding-3-small
HOST=0.0.0.0
PORT=8000
```

## Step 1 — Ensure dependencies
```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Step 2 — Single-doc isolation
Ensure `ai-service/documents/` contains ONLY:
- `Technical Description_Rev01.docx`

## Step 3 — Reset Chroma and re-ingest
```powershell
cd C:\Users\atila\CEW\ai-service
Remove-Item -Recurse -Force chroma_db
python scripts/ingest.py
python scripts/inspect_db.py -n 10
```

## Step 4 — Start backend
```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Step 5 — Generate golden tests from the indexed doc
```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
python scripts/build_golden_from_chroma.py --doc "Technical Description_Rev01.docx"
```

This writes:
- `ai-service/scripts/generated_td_rev01_testcases.json`

## Step 6 — Run benchmark
```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
python scripts/benchmark_td_rev01.py
```

## Scoring
- Target: **≥ 90% pass** (goal **100%**) on `benchmark_td_rev01.py`
- Any answer containing fallback phrasing is a FAIL for that test case
- Any missing citation format is a FAIL (must contain `[Source:` or `[Kaynak:`)

## Debugging failures
If many tests fail:
```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate.ps1
python scripts/diagnose.py
```

Interpretation:
- Check A fails → ingestion/index problem
- Check B fails → retrieval recall problem (top_k / ranking)
- Check C looks good but answers fail → prompt/extraction problem

