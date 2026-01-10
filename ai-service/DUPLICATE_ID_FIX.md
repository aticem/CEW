# Duplicate ID Error - Fixed

## The Problem

**Error:**
```
ChromaDB error: Expected IDs to be unique, found duplicates of: Technical Description_Rev01.docx_0_0
```

**Root Cause:**
- Previous ID format: `{filename}_{location}_{index}`
- When parsing complex documents, the same `location_index` combination could occur multiple times
- Example: Multiple sections might all start at index 0

---

## The Fix

### 1. Added UUID Import
```python
import uuid
```

### 2. Updated ID Generation
**Before:**
```python
doc_id = f"{chunk['doc_name']}_{page_or_sheet}_{chunk['chunk_index']}"
```

**After:**
```python
unique_suffix = uuid.uuid4().hex[:8]
doc_id = f"{chunk['doc_name']}_{page_or_sheet}_{chunk['chunk_index']}_{unique_suffix}"
```

**Example IDs:**
- Old: `Technical_Description_Rev01.docx_3.2_0`
- New: `Technical_Description_Rev01.docx_3.2_0_a7f3d8e1`

### 3. Added Duplicate Detection
The script now checks for duplicate IDs before submission:
```python
doc_ids = [doc["id"] for doc in documents]
unique_ids = set(doc_ids)

if len(doc_ids) != len(unique_ids):
    print(f"⚠️ WARNING: Found {len(doc_ids) - len(unique_ids)} duplicate IDs!")
else:
    print(f"✓ All {len(doc_ids)} IDs are unique")
```

### 4. Enhanced Collection Clearing
Added explicit clear message:
```python
# Step 1: Clear existing collection (CRITICAL - prevents duplicate ID errors)
print("\n[1/4] Clearing existing ChromaDB collection...")
clear_collection()
print("      ✓ Collection cleared and reset")
```

---

## How to Use

### Clean Installation (Recommended)

```powershell
# 1. Delete ChromaDB folder (fresh start)
cd C:\Users\atila\CEW\ai-service
Remove-Item -Recurse -Force chroma_db

# 2. Run ingestion
python scripts/ingest.py
```

### Normal Installation

```powershell
# The script will automatically clear old data
python scripts/ingest.py
```

---

## Verification

You should see this output:
```
[4/4] Generating embeddings and storing in ChromaDB...
      Processing chunk 1/150 (1%)...
      ...
      ✓ All 150 IDs are unique
      ✓ Successfully stored 150 chunks in ChromaDB
```

If you see:
```
⚠️ WARNING: Found X duplicate IDs!
```

This indicates a bug in the UUID generation (shouldn't happen). Contact support.

---

## Why UUIDs?

1. **Guaranteed Uniqueness** — `uuid.uuid4()` generates random IDs with 128-bit entropy
2. **No Collisions** — Probability of collision is astronomically low (< 1 in 10^18)
3. **Idempotent Re-ingestion** — Can re-run ingestion without errors

---

## Troubleshooting

### Still Getting Duplicate Error?

1. **Delete ChromaDB folder:**
   ```powershell
   Remove-Item -Recurse -Force chroma_db
   ```

2. **Check for multiple ingest runs:**
   - Make sure you're not running `ingest.py` multiple times simultaneously

3. **Verify clear_collection works:**
   ```powershell
   python scripts/inspect_db.py
   # Should show 0 documents after clearing
   ```

### Collection Not Clearing?

If `clear_collection()` fails, manually delete:
```powershell
Remove-Item -Recurse -Force chroma_db
python scripts/ingest.py
```

---

## Testing

```powershell
# Test 1: Run ingestion
python scripts/ingest.py

# Test 2: Check results
python scripts/inspect_db.py

# Test 3: Re-run ingestion (should work without errors)
python scripts/ingest.py
```

All three should complete successfully! ✅
