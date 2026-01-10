# Structured Ingestion Upgrade

## What Changed

The ingestion system has been upgraded from **raw text extraction** to **structured parsing**.

### Before (Raw Text)
```
"CEW Project Specification Section 1: Overview Trench depth shall be minimum 800mm..."
```

### After (Structured Key-Value)
```
"SOURCE: Technical Description_Rev01.docx | SECTION: 3.2 Trench Specifications | CONTENT: Trench depth shall be minimum 800mm from finished ground level..."
```

---

## New Parsing Logic

### Excel Files (.xlsx)
- **Row-by-row parsing** with column headers
- Each row becomes: `SOURCE: file.xlsx | SHEET: SheetName | ROW: 5 | DATA: Column1: Value1, Column2: Value2`
- Skips empty cells (NaN)
- Preserves data types

### PDF Files (.pdf)
- **Table extraction first** (using `pdfplumber`)
- Tables become: `SOURCE: file.pdf | PAGE: 3 | TABLE: 1 | ROW: 5 | DATA: Col1: Val1, Col2: Val2`
- **Text fallback** if no tables found
- Preserves layout

### Word Files (.docx)
- **Section-based grouping** (detects headers)
- Format: `SOURCE: file.docx | SECTION: 3.2 Technical Specs | CONTENT: ...`
- **Table extraction** as structured data

---

## Installation

### 1. Update Dependencies

```powershell
cd C:\Users\atila\CEW\ai-service
.\venv\Scripts\Activate
pip install -r requirements.txt
```

Key new dependencies:
- `pdfplumber==0.11.0` (replaces PyMuPDF)
- `pandas` (already installed)
- `openpyxl` (already installed)

### 2. Re-run Ingestion

```powershell
python scripts/ingest.py
```

This will:
1. Clear old data from ChromaDB
2. Parse documents with structured extraction
3. Store structured chunks

### 3. Verify Results

```powershell
python scripts/inspect_db.py
```

You should see output like:
```
📌 Document #1
ID: Technical Description_Rev01.docx_3.2_0
🏷️  Metadata:
   doc_name: Technical Description_Rev01.docx
   section: 3.2 Trench Specifications
📝 Content Preview:
SOURCE: Technical Description_Rev01.docx | SECTION: 3.2 Trench Specifications | CONTENT: Trench depth shall be minimum 800mm...
```

---

## Benefits

### 1. **Better RAG Accuracy**
The AI can now see the structure of data:
- **Before:** "800 mm" (ambiguous)
- **After:** "Trench depth: 800mm" (clear key-value pair)

### 2. **Source Traceability**
Every chunk includes:
- Source filename
- Sheet/page/section location
- Row/table numbers (for tabular data)

### 3. **Fewer Hallucinations**
Structured data reduces ambiguity and improves LLM grounding.

### 4. **Excel & PDF Tables**
Previously, tables were flattened to text. Now they're preserved as key-value pairs.

---

## Example Outputs

### Excel BOM
```
SOURCE: bill of m 227-005-L-E-00010 Rev07.xlsx | SHEET: DC Cable BOM | ROW: 5 | DATA: Item: DC-001, Description: DC Cable 4mm² Black, Quantity: 5000, Unit: m, Supplier: Supplier A
```

### PDF Table
```
SOURCE: 277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf | PAGE: 3 | TABLE: 1 | ROW: 4 | DATA: Trench ID: T-42, Depth: 800mm, Width: 300mm, Length: 150m
```

### Word Document
```
SOURCE: Technical Description_Rev01.docx | SECTION: 3.2 Trench Specifications | CONTENT: All trenches shall be excavated to a minimum depth of 800mm from finished ground level. Width shall not exceed 300mm.
```

---

## Troubleshooting

### Empty ChromaDB After Ingestion
- Check terminal output for parsing errors
- Verify documents are text-based PDFs (not scanned images)
- Run `python scripts/inspect_db.py` to see what was ingested

### "No tables found" for PDF
- Some PDFs store data as text, not tables
- The script will fall back to text extraction automatically

### Excel shows fewer rows than expected
- Empty rows are skipped
- Rows with all NaN values are skipped

---

## Commands Reference

```powershell
# Install/update dependencies
pip install -r requirements.txt

# Run structured ingestion
python scripts/ingest.py

# Inspect ChromaDB contents (first 5 docs)
python scripts/inspect_db.py

# Inspect all documents
python scripts/inspect_db.py --all

# Inspect specific number
python scripts/inspect_db.py -n 10

# Start AI service
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
