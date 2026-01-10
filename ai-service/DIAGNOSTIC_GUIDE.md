# RAG Diagnostic Script - Quick Run

## Purpose
Scientific debugging tool that traces the EXACT data flow through the RAG pipeline.

## Usage

```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate
python scripts/diagnose.py
```

## What It Tests

### Check A: Raw Database Search
- Searches ChromaDB directly for keywords: "Jinko", "Panel", "Brand"
- **Pass:** Data exists in database
- **Fail:** Data not ingested properly

### Check B: Retriever Logic
- Uses the EXACT retrieval logic from `rag_service.py`
- Tests query: "Panel markası nedir?"
- **Pass:** Relevant documents retrieved, keywords found in context
- **Fail:** TOP_K_RESULTS too low, relevant data not in top results

### Check C: LLM Context
- Shows the EXACT string that would be sent to LLM
- Prints full context with all chunks
- **Pass:** Context contains the answer
- **Fail:** System prompt or context formatting issue

## Expected Output

### ✅ All Checks Pass

```
CHECK A: RAW DATABASE SEARCH
✅ Found 'Jinko' in 5 documents
✅ CHECK A PASSED: Data exists in ChromaDB!

CHECK B: RETRIEVER LOGIC
✅ Retrieved 25 documents
🎯 CONTAINS: Jinko, Brand, Solar
✅ CHECK B PASSED: Relevant data IS being retrieved!

CHECK C: LLM CONTEXT PREVIEW
✅ CHECK C PASSED: Context contains answer!

🎯 DIAGNOSTIC COMPLETE
✅ ALL CHECKS PASSED!
```

### ❌ Check A Fails (No Data)

```
CHECK A: RAW DATABASE SEARCH
❌ NOT found: 'Jinko'
❌ CHECK A FAILED: Keywords NOT found in database!

🛑 STOPPED: Data not found in ChromaDB

🔧 SOLUTION:
   1. Delete chroma_db/ folder
   2. Run: python scripts/ingest.py
   3. Re-run this diagnostic
```

**Fix:** Re-ingest data

### ❌ Check B Fails (Low Recall)

```
CHECK A: RAW DATABASE SEARCH
✅ CHECK A PASSED: Data exists in ChromaDB!

CHECK B: RETRIEVER LOGIC
❌ CHECK B FAILED: Retrieved documents do NOT contain the answer!
   Retrieved 25 docs, but none contain keywords.
   Diagnosis: TOP_K_RESULTS (25) is TOO LOW

🛑 STOPPED: Retriever not finding relevant data

🔧 SOLUTION:
   Problem: TOP_K_RESULTS is too low for structured data
   Fix: Edit app/config.py
   Change: TOP_K_RESULTS = 25  →  TOP_K_RESULTS = 50
```

**Fix:** Increase TOP_K_RESULTS

### ❌ Check C Fails (Prompt Issue)

```
CHECK A: RAW DATABASE SEARCH
✅ CHECK A PASSED

CHECK B: RETRIEVER LOGIC
✅ CHECK B PASSED: Relevant data IS being retrieved!

CHECK C: LLM CONTEXT PREVIEW
✅ CHECK C PASSED: Context contains answer!

📊 CONCLUSION:
   The RAG pipeline is working correctly.
   If AI still fails to answer:
   🔧 Fix: Update app/prompts/system_general.txt
```

**Fix:** Update system prompt to be less strict

## Fixes Based on Output

### Scenario 1: Check A Fails
```powershell
# Delete ChromaDB
Remove-Item -Recurse -Force chroma_db

# Re-ingest
python scripts/ingest.py

# Test again
python scripts/diagnose.py
```

### Scenario 2: Check B Fails

**File:** `app/config.py`

```python
# Change this line:
TOP_K_RESULTS = 25  # Old value

# To this:
TOP_K_RESULTS = 50  # Increased for structured data
```

Then restart service and test again.

### Scenario 3: Check C Passes but AI Still Fails

**File:** `app/prompts/system_general.txt`

Make the prompt more flexible:
- Reduce strictness on "ONLY" requirement
- Add explicit instruction to extract from structured data
- Allow answering when value is found in DATA section

## Advanced Usage

### Test Different Queries

Edit `diagnose.py` line 212:
```python
test_query = "Panel markası nedir?"  # Change this
```

### Check More Documents

Edit line 30:
```python
limit=1000,  # Increase to check more docs
```

### Lower Similarity Threshold

Edit line 141:
```python
relevant_results = [r for r in results if r["score"] >= 0.5]  # Lower from 0.7
```

## Troubleshooting

### "Collection is EMPTY"
- ChromaDB not initialized
- Run `python scripts/ingest.py`

### "No documents retrieved"
- Embedding service not working
- Check OPENAI_API_KEY in .env

### "All documents below threshold"
- SIMILARITY_THRESHOLD too high
- Lower it in config.py or diagnose.py

## Next Steps After Diagnosis

1. **Run the diagnostic:**
   ```powershell
   python scripts/diagnose.py
   ```

2. **Read the output carefully**
   - Note which check fails
   - Follow the specific fix shown

3. **Apply the fix**
   - Edit the suggested file
   - Restart service if needed

4. **Re-run diagnostic**
   - Verify the fix worked
   - All checks should pass

5. **Test with real query**
   - Use the AI Assistant
   - Ask "Panel markası nedir?"
   - Should get correct answer now
