# CEW AI ASSISTANT – INGEST PIPELINE DESIGN

**Version:** 1.0  
**Date:** 2026-01-06  
**Purpose:** Detailed design of Google Drive document ingestion pipeline

---

## OVERVIEW

The ingest pipeline transforms documents from Google Drive into searchable vector embeddings with full metadata traceability.

**Key Constraints:**
- ❌ No OCR (scanned PDFs are flagged but not processed)
- ✅ PDFs with selectable text are fully supported
- ✅ Excel and Word documents are fully supported
- ✅ Documents are chunked once (not per query)
- ✅ Each chunk retains: document name, Drive link, page number, section heading

---

## PIPELINE STAGES

```
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 1: FETCH                                │
│  Google Drive API → List files → Download content                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 2: PARSE                                │
│  Identify file type → Extract text → Classify document type      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 3: CHUNK                                │
│  Split text → Semantic chunking → Overlap strategy               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 4: EMBED                                │
│  Generate embeddings → Batch processing → Rate limiting          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 5: STORE                                │
│  Upsert to Vector DB → Store metadata → Update index             │
└─────────────────────────────────────────────────────────────────┘
```

---

## STAGE 1: FETCH (Google Drive)

### 1.1 Authentication
**Service Account Setup:**
- Create Google Cloud Project
- Enable Google Drive API
- Create Service Account with read-only permissions
- Download JSON key file (stored securely, not in version control)
- Share `CEW_AI/` folder with service account email

**Code Location:** `src/ingest/drive/driveClient.js`

**Implementation:**
```javascript
// Pseudo-code (not actual implementation)
const { google } = require('googleapis');
const credentials = require('./service-account-key.json');

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive.readonly']
});

const drive = google.drive({ version: 'v3', auth });
```

---

### 1.2 File Discovery
**Process:**
1. Get `CEW_AI/` folder ID from config
2. List all files recursively (including subfolders)
3. Filter by supported file types: `.pdf`, `.xlsx`, `.xls`, `.docx`, `.doc`
4. Retrieve metadata for each file:
   - File ID
   - File name
   - MIME type
   - Parent folder path
   - Modified date
   - Web view link (Drive URL)

**Code Location:** `src/ingest/drive/fileListService.js`

**API Call:**
```javascript
// Pseudo-code
const response = await drive.files.list({
  q: `'${CEW_AI_FOLDER_ID}' in parents and trashed=false`,
  fields: 'files(id, name, mimeType, parents, modifiedTime, webViewLink)',
  pageSize: 1000
});
```

**Output:**
```javascript
[
  {
    id: '1a2b3c4d5e6f',
    name: '277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf',
    mimeType: 'application/pdf',
    folder: 'QAQC/Checklists/electrical/dc-cable',
    modifiedTime: '2026-01-05T10:30:00Z',
    webViewLink: 'https://drive.google.com/file/d/1a2b3c4d5e6f/view'
  },
  // ... more files
]
```

---

### 1.3 File Download
**Process:**
1. For each file, download content as buffer
2. Handle large files (stream processing)
3. Retry on network errors (exponential backoff)

**Code Location:** `src/ingest/drive/fileDownloadService.js`

**API Call:**
```javascript
// Pseudo-code
const response = await drive.files.get(
  { fileId: fileId, alt: 'media' },
  { responseType: 'arraybuffer' }
);

const buffer = Buffer.from(response.data);
```

---

## STAGE 2: PARSE (Document Processing)

### 2.1 File Type Detection
**Process:**
1. Check file extension
2. Verify MIME type
3. Route to appropriate parser

**Code Location:** `src/ingest/parsers/parserFactory.js`

**Supported Types:**
| Extension | MIME Type | Parser |
|-----------|-----------|--------|
| `.pdf` | `application/pdf` | pdfParser.js |
| `.xlsx`, `.xls` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | excelParser.js |
| `.docx`, `.doc` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | wordParser.js |

---

### 2.2 PDF Parsing

#### 2.2.1 Text Extraction
**Library:** `pdf-parse` (Node.js)

**Process:**
1. Load PDF buffer
2. Extract text page by page
3. Preserve page numbers
4. Detect if text is selectable

**Code Location:** `src/ingest/parsers/pdfParser.js`

**Implementation:**
```javascript
// Pseudo-code
const pdfParse = require('pdf-parse');

async function parsePDF(buffer, metadata) {
  const data = await pdfParse(buffer);
  
  // Check if text is extractable
  if (data.text.trim().length < 50) {
    return {
      type: 'SCANNED_PDF',
      status: 'OCR_REQUIRED',
      pages: []
    };
  }
  
  // Extract text per page
  const pages = [];
  for (let i = 1; i <= data.numpages; i++) {
    const pageText = await extractPageText(buffer, i);
    pages.push({
      pageNumber: i,
      text: pageText,
      hasText: pageText.trim().length > 0
    });
  }
  
  return {
    type: 'PDF_TEXT',
    status: 'SUCCESS',
    pages: pages,
    totalPages: data.numpages
  };
}
```

**Output:**
```javascript
{
  type: 'PDF_TEXT',
  status: 'SUCCESS',
  pages: [
    {
      pageNumber: 1,
      text: 'CEW Project Specification\n\nSection 1: Overview...',
      hasText: true
    },
    {
      pageNumber: 2,
      text: 'Section 2: Technical Requirements\n\nTrench depth shall be...',
      hasText: true
    }
  ],
  totalPages: 25
}
```

---

#### 2.2.2 PDF Classification
**Process:**
1. Analyze text density per page
2. Detect if document is text-heavy or drawing-heavy
3. Classify as `PDF_TEXT`, `PDF_DRAWING`, or `SCANNED_PDF`

**Code Location:** `src/ingest/parsers/documentClassifier.js`

**Classification Rules:**
- **PDF_TEXT**: >80% of pages have >200 characters
- **PDF_DRAWING**: 20-80% of pages have text (legends, titles, notes)
- **SCANNED_PDF**: <20% of pages have text (flag for OCR, skip in MVP)

**Implementation:**
```javascript
// Pseudo-code
function classifyPDF(pages) {
  const textPages = pages.filter(p => p.text.length > 200).length;
  const textRatio = textPages / pages.length;
  
  if (textRatio > 0.8) return 'PDF_TEXT';
  if (textRatio > 0.2) return 'PDF_DRAWING';
  return 'SCANNED_PDF';
}
```

---

#### 2.2.3 Section Heading Detection
**Process:**
1. Analyze text formatting (font size, bold, uppercase)
2. Use regex patterns to detect headings
3. Associate text blocks with nearest heading

**Heuristics:**
- Lines with ALL CAPS and <100 characters
- Lines starting with numbers (e.g., "1.0", "2.3.1")
- Lines with keywords: "Section", "Chapter", "Appendix"

**Implementation:**
```javascript
// Pseudo-code
function detectHeadings(text) {
  const lines = text.split('\n');
  const headings = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Pattern 1: ALL CAPS
    if (line === line.toUpperCase() && line.length < 100 && line.length > 5) {
      headings.push({ line: i, text: line });
    }
    
    // Pattern 2: Numbered sections
    if (/^\d+(\.\d+)*\s+[A-Z]/.test(line)) {
      headings.push({ line: i, text: line });
    }
    
    // Pattern 3: Keywords
    if (/^(Section|Chapter|Appendix|Part)\s+\d+/i.test(line)) {
      headings.push({ line: i, text: line });
    }
  }
  
  return headings;
}
```

**Output:**
```javascript
[
  { line: 5, text: 'SECTION 1: OVERVIEW' },
  { line: 42, text: '1.1 Project Scope' },
  { line: 89, text: 'SECTION 2: TECHNICAL REQUIREMENTS' },
  { line: 105, text: '2.1 Trench Specifications' }
]
```

---

### 2.3 Excel Parsing

**Library:** `exceljs` (Node.js)

**Process:**
1. Load Excel buffer
2. Iterate through all sheets
3. Extract rows with headers
4. Preserve sheet names and row numbers

**Code Location:** `src/ingest/parsers/excelParser.js`

**Implementation:**
```javascript
// Pseudo-code
const ExcelJS = require('exceljs');

async function parseExcel(buffer, metadata) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  
  const sheets = [];
  
  workbook.eachSheet((worksheet, sheetId) => {
    const rows = [];
    const headers = [];
    
    // Get headers from first row
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = cell.value;
    });
    
    // Get data rows
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      
      const rowData = {};
      row.eachCell((cell, colNumber) => {
        rowData[headers[colNumber]] = cell.value;
      });
      
      rows.push({
        rowNumber: rowNumber,
        data: rowData
      });
    });
    
    sheets.push({
      sheetName: worksheet.name,
      headers: headers,
      rows: rows
    });
  });
  
  return {
    type: 'EXCEL_BOM',
    status: 'SUCCESS',
    sheets: sheets
  };
}
```

**Output:**
```javascript
{
  type: 'EXCEL_BOM',
  status: 'SUCCESS',
  sheets: [
    {
      sheetName: 'DC Cable BOM',
      headers: ['Item', 'Description', 'Quantity', 'Unit', 'Supplier'],
      rows: [
        {
          rowNumber: 2,
          data: {
            'Item': 'DC-001',
            'Description': 'DC Cable 4mm² Black',
            'Quantity': 5000,
            'Unit': 'm',
            'Supplier': 'Supplier A'
          }
        },
        // ... more rows
      ]
    }
  ]
}
```

---

### 2.4 Word Parsing

**Library:** `mammoth` (Node.js)

**Process:**
1. Load Word buffer
2. Extract text with basic formatting
3. Preserve paragraph structure
4. Detect headings (based on styles)

**Code Location:** `src/ingest/parsers/wordParser.js`

**Implementation:**
```javascript
// Pseudo-code
const mammoth = require('mammoth');

async function parseWord(buffer, metadata) {
  const result = await mammoth.extractRawText({ buffer: buffer });
  
  const paragraphs = result.value.split('\n\n');
  
  return {
    type: 'WORD_DOC',
    status: 'SUCCESS',
    text: result.value,
    paragraphs: paragraphs
  };
}
```

**Output:**
```javascript
{
  type: 'WORD_DOC',
  status: 'SUCCESS',
  text: 'Project Manual\n\nSection 1: Introduction...',
  paragraphs: [
    'Project Manual',
    'Section 1: Introduction',
    'This document describes...'
  ]
}
```

---

## STAGE 3: CHUNK (Text Segmentation)

### 3.1 Chunking Strategy

**Goal:** Split documents into semantic chunks that:
- Are small enough for embedding models (500-1000 tokens)
- Are large enough to contain meaningful context
- Overlap to preserve context across boundaries
- Retain metadata (page, section, document)

**Configuration:** `src/config/chunking.config.js`
```javascript
{
  chunkSize: 500,        // tokens
  chunkOverlap: 50,      // tokens
  strategy: 'semantic',  // 'semantic' or 'fixed'
  minChunkSize: 100      // tokens
}
```

---

### 3.2 PDF Text Chunking

**Code Location:** `src/ingest/chunking/textChunker.js`

**Process:**
1. Combine pages into continuous text
2. Split by section headings (if detected)
3. Further split by token count (500 tokens)
4. Add overlap (50 tokens)
5. Associate each chunk with page number and section

**Implementation:**
```javascript
// Pseudo-code
function chunkPDFText(pages, headings, chunkSize = 500, overlap = 50) {
  const chunks = [];
  let currentSection = 'Introduction';
  
  for (const page of pages) {
    // Update current section if heading found
    const pageHeading = headings.find(h => h.pageNumber === page.pageNumber);
    if (pageHeading) {
      currentSection = pageHeading.text;
    }
    
    // Split page text into chunks
    const pageChunks = splitByTokens(page.text, chunkSize, overlap);
    
    for (const chunk of pageChunks) {
      chunks.push({
        text: chunk.text,
        pageNumber: page.pageNumber,
        section: currentSection,
        tokenCount: chunk.tokenCount
      });
    }
  }
  
  return chunks;
}

function splitByTokens(text, chunkSize, overlap) {
  // Tokenize text (simple word-based tokenization)
  const words = text.split(/\s+/);
  const chunks = [];
  
  for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push({
      text: chunkWords.join(' '),
      tokenCount: chunkWords.length
    });
  }
  
  return chunks;
}
```

**Output:**
```javascript
[
  {
    text: 'Section 2: Technical Requirements\n\nTrench depth shall be minimum 800mm from finished ground level. Trench width shall be 300mm minimum...',
    pageNumber: 5,
    section: 'Section 2: Technical Requirements',
    tokenCount: 487
  },
  {
    text: '...Trench width shall be 300mm minimum. Backfill material shall be sand or approved equivalent. Compaction shall be...',
    pageNumber: 5,
    section: 'Section 2: Technical Requirements',
    tokenCount: 502
  }
]
```

---

### 3.3 Excel Chunking

**Code Location:** `src/ingest/chunking/excelChunker.js`

**Strategy:** Each row is a chunk (for BOM/BOQ documents)

**Process:**
1. Each row becomes a separate chunk
2. Include sheet name and row number
3. Format as natural language

**Implementation:**
```javascript
// Pseudo-code
function chunkExcel(sheets) {
  const chunks = [];
  
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      // Format row as natural language
      const text = formatRowAsText(row.data, sheet.headers);
      
      chunks.push({
        text: text,
        sheetName: sheet.sheetName,
        rowNumber: row.rowNumber,
        rawData: row.data
      });
    }
  }
  
  return chunks;
}

function formatRowAsText(data, headers) {
  // Convert row to natural language
  // Example: "Item DC-001: DC Cable 4mm² Black, Quantity: 5000m, Supplier: Supplier A"
  const parts = [];
  for (const [key, value] of Object.entries(data)) {
    if (value) parts.push(`${key}: ${value}`);
  }
  return parts.join(', ');
}
```

**Output:**
```javascript
[
  {
    text: 'Item: DC-001, Description: DC Cable 4mm² Black, Quantity: 5000, Unit: m, Supplier: Supplier A',
    sheetName: 'DC Cable BOM',
    rowNumber: 2,
    rawData: { Item: 'DC-001', Description: 'DC Cable 4mm² Black', ... }
  }
]
```

---

### 3.4 Word Chunking

**Code Location:** `src/ingest/chunking/textChunker.js` (same as PDF)

**Process:**
1. Split by paragraphs
2. Combine paragraphs until token limit
3. Add overlap

---

## STAGE 4: EMBED (Vector Generation)

### 4.1 Embedding Service

**Code Location:** `src/ingest/embeddings/embeddingService.js`

**Provider:** OpenAI `text-embedding-3-small` (1536 dimensions)

**Process:**
1. Take chunk text
2. Call embedding API
3. Return vector (array of floats)

**Implementation:**
```javascript
// Pseudo-code
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  
  return response.data[0].embedding; // [0.123, -0.456, ...]
}
```

---

### 4.2 Batch Processing

**Code Location:** `src/ingest/embeddings/batchEmbedding.js`

**Process:**
1. Group chunks into batches (max 100 per batch)
2. Call embedding API once per batch
3. Rate limiting (respect API limits)
4. Retry on errors

**Implementation:**
```javascript
// Pseudo-code
async function batchGenerateEmbeddings(chunks, batchSize = 100) {
  const embeddings = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.text);
    
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts
    });
    
    embeddings.push(...response.data.map(d => d.embedding));
    
    // Rate limiting: wait 1 second between batches
    await sleep(1000);
  }
  
  return embeddings;
}
```

---

## STAGE 5: STORE (Vector Database)

### 5.1 Metadata Schema

**Code Location:** `src/ingest/metadata/metadataSchema.js`

**Each chunk stores:**
```javascript
{
  // Vector DB fields
  id: 'doc_1a2b3c_chunk_5',
  embedding: [0.123, -0.456, ...], // 1536 dimensions
  
  // Metadata
  metadata: {
    // Document info
    doc_id: '1a2b3c4d5e6f',
    doc_name: '277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf',
    doc_type: 'PDF_TEXT',
    drive_link: 'https://drive.google.com/file/d/1a2b3c4d5e6f/view',
    
    // Location info
    folder: 'QAQC/Checklists/electrical/dc-cable',
    page: 5,
    section: 'Section 2: Technical Requirements',
    
    // Excel-specific (if applicable)
    sheet_name: null,
    row_number: null,
    
    // Timestamps
    ingested_at: '2026-01-06T19:30:00Z',
    updated_at: '2026-01-06T19:30:00Z',
    
    // Chunk info
    chunk_index: 5,
    chunk_text: 'Trench depth shall be minimum 800mm...',
    token_count: 487
  }
}
```

---

### 5.2 Upsert to Vector DB

**Code Location:** `src/vector/vectorDbClient.js`

**Process:**
1. Generate unique ID for each chunk
2. Upsert to vector database (create or update)
3. Handle errors (retry, log failures)

**Implementation:**
```javascript
// Pseudo-code
async function upsertChunks(chunks, embeddings, documentMetadata) {
  const vectors = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];
    
    vectors.push({
      id: `doc_${documentMetadata.doc_id}_chunk_${i}`,
      values: embedding,
      metadata: {
        doc_id: documentMetadata.doc_id,
        doc_name: documentMetadata.doc_name,
        doc_type: documentMetadata.doc_type,
        drive_link: documentMetadata.drive_link,
        folder: documentMetadata.folder,
        page: chunk.pageNumber || null,
        section: chunk.section || null,
        sheet_name: chunk.sheetName || null,
        row_number: chunk.rowNumber || null,
        ingested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        chunk_index: i,
        chunk_text: chunk.text,
        token_count: chunk.tokenCount
      }
    });
  }
  
  // Upsert to Pinecone/Qdrant
  await vectorDb.upsert(vectors);
}
```

---

## COMPLETE FLOW EXAMPLE

### Input: PDF Document
```
File: 277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf
Drive Link: https://drive.google.com/file/d/1a2b3c4d5e6f/view
Folder: QAQC/Checklists/electrical/dc-cable
Pages: 25
```

### Stage 1: Fetch
- Download PDF buffer from Google Drive
- Retrieve metadata (name, link, folder, modified date)

### Stage 2: Parse
- Extract text from all 25 pages
- Classify as `PDF_TEXT` (text-heavy)
- Detect section headings:
  - Page 1: "SECTION 1: OVERVIEW"
  - Page 5: "SECTION 2: TECHNICAL REQUIREMENTS"
  - Page 12: "SECTION 3: INSTALLATION PROCEDURES"

### Stage 3: Chunk
- Split into 47 chunks (500 tokens each, 50 overlap)
- Associate each chunk with page number and section
- Example chunk:
  ```
  Page: 5
  Section: "SECTION 2: TECHNICAL REQUIREMENTS"
  Text: "Trench depth shall be minimum 800mm from finished ground level..."
  Tokens: 487
  ```

### Stage 4: Embed
- Generate embeddings for all 47 chunks (batch processing)
- Each embedding: 1536-dimensional vector

### Stage 5: Store
- Upsert 47 vectors to Pinecone/Qdrant
- Each vector includes full metadata:
  - Document name, Drive link, page, section
  - Chunk text, token count, timestamps

### Result
- 1 document → 47 searchable chunks
- Each chunk traceable to source (document, page, section)
- Ready for semantic search

---

## ERROR HANDLING

### Unsupported Files
- **Scanned PDFs**: Flag as `OCR_REQUIRED`, skip in MVP
- **Corrupted files**: Log error, continue with next file
- **Large files**: Stream processing, timeout handling

### API Failures
- **Google Drive API**: Retry with exponential backoff (3 attempts)
- **Embedding API**: Retry with exponential backoff (3 attempts)
- **Vector DB**: Retry with exponential backoff (3 attempts)

### Logging
- Log each stage (fetch, parse, chunk, embed, store)
- Log errors with file name and stage
- Track progress (files processed, chunks created)

---

## PERFORMANCE CONSIDERATIONS

### Batch Processing
- Embed 100 chunks per API call (reduce latency)
- Upsert 1000 vectors per Vector DB call

### Rate Limiting
- OpenAI: 3,000 requests/minute (batch to stay under limit)
- Google Drive: 1,000 requests/100 seconds
- Vector DB: Provider-specific limits

### Parallelization
- Process multiple files in parallel (max 5 concurrent)
- Embed chunks in parallel (batch processing)

### Estimated Time
- 500 documents, ~5,000 chunks
- Embedding: ~5 minutes (batched)
- Total ingest: ~10-15 minutes

---

## NEXT STEPS

1. Implement Google Drive client
2. Implement parsers (PDF, Excel, Word)
3. Implement chunking strategies
4. Implement embedding service
5. Implement Vector DB upsert
6. Test with real CEW documents
7. Monitor and optimize performance

---

**End of Ingest Pipeline Design Document**
