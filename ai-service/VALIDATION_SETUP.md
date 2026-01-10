# CEW AI Assistant - Validation Setup Guide

## Overview

This guide explains how to run the **Self-Validation Loop** for the CEW AI Assistant Document Reading System. The validation framework tests 40 critical questions against the Technical Description document to ensure 100% accuracy with zero hallucination.

---

## What's Been Set Up

### ✅ Completed Setup

1. **Validation Document** (`VALIDATION_DOCUMENT_READING.md`)
   - 40 validation questions across 9 categories
   - Expected answers extracted from Technical Description_Rev01.docx
   - Source references for each answer
   - Pass/Fail tracking

2. **Automated Validation Script** (`scripts/validate.js`)
   - Queries AI service for all 40 questions
   - Validates responses against expected answers
   - Checks for proper "not found" behavior
   - Generates detailed validation report

3. **Docker Infrastructure**
   - Qdrant vector database (running on port 6333)
   - Docker Compose configuration

4. **Environment Configuration**
   - `.env` file template created
   - Qdrant connection configured

---

## Prerequisites

### Required

- ✅ **Node.js 18+** (installed)
- ✅ **Docker** (installed)
- ✅ **Qdrant** (running - started via docker-compose)
- ✅ **Dependencies** (installed via npm install)

### API Keys Needed

You need to add your **OpenAI API key** to `/workspaces/CEW/ai-service/.env`:

```bash
# Current (needs update):
OPENAI_API_KEY=your-openai-api-key-here

# Replace with your actual key:
OPENAI_API_KEY=sk-proj-...your-actual-key...
```

**Why OpenAI?**
- Embeddings: `text-embedding-3-small` (converts text to vectors)
- LLM: `gpt-4-turbo-preview` (generates answers)

**Note:** The PRD specifies Claude Sonnet, but the current implementation uses OpenAI. You can switch to Claude by:
1. Installing `@anthropic-ai/sdk`
2. Updating `src/query/llm/llmService.js`
3. Adding `ANTHROPIC_API_KEY` to `.env`

---

## Running the Validation

### Step 1: Verify Qdrant is Running

```bash
# Check Qdrant status
docker ps | grep qdrant

# Should show:
# cew-qdrant   Up X minutes   6333-6334/tcp

# Test Qdrant health
curl http://localhost:6333/health
# Should return: {"title":"qdrant - vector search engine","version":"..."}
```

### Step 2: Add Your OpenAI API Key

```bash
cd /workspaces/CEW/ai-service
nano .env  # or use VS Code to edit

# Update this line:
OPENAI_API_KEY=sk-proj-YOUR-ACTUAL-KEY-HERE
```

### Step 3: Start the AI Service

```bash
cd /workspaces/CEW/ai-service
npm run dev
```

**Expected output:**
```
[INFO] AI Service starting...
[INFO] Connected to Qdrant at http://localhost:6333
[INFO] Server listening on http://localhost:3001
```

**Keep this terminal running!**

### Step 4: Ingest the Technical Description Document

Open a **new terminal** and run:

```bash
cd /workspaces/CEW/ai-service
npm run ingest
```

**Expected output:**
```
📄 Processing: Technical Description_Rev01.docx
✅ Parsed successfully
✅ Chunked into X chunks
✅ Generated embeddings
✅ Stored in Qdrant
---
Ingestion Complete: 1 document, X chunks
```

**This step is critical!** It:
1. Parses the Word document
2. Chunks it into semantic sections
3. Generates vector embeddings
4. Stores everything in Qdrant

### Step 5: Run the Validation

In a **third terminal**:

```bash
cd /workspaces/CEW/ai-service
npm run validate
```

**What happens:**
- Validates AI service is running
- Runs all 40 questions sequentially
- Checks each answer against expected results
- Saves detailed results to `validation-results.json`
- Updates `VALIDATION_DOCUMENT_READING.md`

**Expected output:**
```
🚀 Starting Validation Loop...
═══════════════════════════════════════════════════════

📝 Question 1/40: What is the total DC capacity of the Haunton PV Plant?
✅ PASS: Contains expected term: "69,991"
   AI Answer: The total DC capacity of the Haunton PV Plant is 69,991.56 kWp...

📝 Question 2/40: Where is the project located?
✅ PASS: Contains expected term: "haunton"
   AI Answer: The project is located near Haunton, Tamworth, United Kingdom...

... (38 more questions) ...

═══════════════════════════════════════════════════════
📊 VALIDATION SUMMARY
═══════════════════════════════════════════════════════
Total Questions: 40
✅ Passed: 38
❌ Failed: 2
Pass Rate: 95.0%
═══════════════════════════════════════════════════════
```

---

## Understanding Results

### Success (100% Pass Rate)

If all 40 questions pass:
```
🎉 ALL VALIDATION TESTS PASSED! System is ready for production.
```

**This means:**
- ✅ Document parsing works correctly
- ✅ Chunking preserves context
- ✅ Vector retrieval finds relevant information
- ✅ LLM generates accurate, source-backed answers
- ✅ System correctly refuses to answer when information is missing

### Failures (< 100% Pass Rate)

If any questions fail:
```
⚠️  Some validation tests failed. Review the results and fix issues.
```

**Check `validation-results.json` for details:**

```json
{
  "id": 15,
  "question": "What is the DC/AC ratio of the PV plant at maximum AC power?",
  "expectedAnswer": "1.291 @30°C",
  "aiResponse": "The DC/AC ratio is approximately 1.29",
  "pass": false,
  "reason": "Response does not match expected answer"
}
```

**Common failure causes:**

1. **Parsing Issues**
   - Tables not extracted correctly
   - Formatting lost during conversion
   - **Fix:** Update `src/ingest/parsers/wordParser.js`

2. **Chunking Issues**
   - Important context split across chunks
   - Tables broken mid-row
   - **Fix:** Adjust `CHUNK_SIZE` in `.env` or improve `src/ingest/chunking/textChunker.js`

3. **Retrieval Issues**
   - Relevant chunks not retrieved (similarity score too low)
   - Wrong chunks retrieved
   - **Fix:** Tune retrieval parameters in `src/query/queryPipeline.js`

4. **Prompting Issues**
   - LLM hallucinating or guessing
   - Not following system prompt rules
   - **Fix:** Update `src/prompts/system/systemPrompt.txt`

---

## Fixing Failures - The Loop

### Iteration Process

```
1. Run validation → Identify failures
2. Analyze root cause
3. Fix the issue
4. Re-run validation
5. Repeat until 100% pass rate
```

### Example Fix Workflow

**Scenario:** Question 26 fails - "What is the minimum trench depth for cable burial?"

**Step 1: Check the Answer**
```json
{
  "aiResponse": "The cables shall be buried with minimum depth.",
  "expectedAnswer": "70 cm",
  "pass": false
}
```

**Step 2: Check the Source Document**
- Open `documents/Technical Description_Rev01.docx`
- Search for "minimum depth"
- Found: "The cables shall be buried with minimum depth of 70 cm"

**Step 3: Diagnose**
- The information EXISTS in the document
- But the AI didn't include the specific value (70 cm)
- Likely cause: Chunking split the sentence, or retrieval didn't find it

**Step 4: Check Chunking**
```bash
# Add debug logging to see chunks
cd /workspaces/CEW/ai-service
npm run ingest -- --debug
```

**Step 5: Fix**
If the chunk is split:
```javascript
// In src/ingest/chunking/textChunker.js
// Increase context window or improve semantic boundaries
```

**Step 6: Re-run**
```bash
npm run validate
```

---

## Validation Categories

### A) General Project Information (5 questions)
- Total DC capacity
- Location
- Number of substations
- Ambient temperatures
- Voltage levels

### B) PV Modules (5 questions)
- Module models
- Modules per string
- System voltage
- Bifacial factor
- Operating temperature

### C) Inverters (5 questions)
- Inverter model
- MPPT voltage range
- Max DC voltage
- Independent MPPT inputs
- DC/AC ratio

### D) Configuration (5 questions)
- Modules per string
- Total strings
- Total inverters
- Power stations
- Nameplate capacity

### E) Substations (4 questions)
- Substation 1 capacity
- Substation 4 inverters
- Mixed module substations
- Substation 6 DC/AC ratio

### F) Earthing & Cabling (4 questions)
- Earthing depth
- Trench depth
- Cable types
- MV cable voltage

### G) Civil & Access (3 questions)
- Road width
- Road curvature
- Fence materials

### H) Systems & Safety (4 questions)
- Surge arresters
- Monitoring systems
- Weather stations
- Security measures

### I) Negative/Control Questions (5 questions)
- Tests proper "not found" behavior
- Ensures no hallucination
- Validates refusal to guess

---

## Expected Behavior

### ✅ Correct Responses

**When information is found:**
```
Question: What is the total DC capacity of the Haunton PV Plant?
Answer: The total DC capacity of the Haunton PV Plant is 69,991.56 kWp as 
specified in Section 1 - INTRODUCTION and Section 4.5 - CONFIGURATION (Table 6).

Sources:
- Document: Technical Description_Rev01.docx
- Section: 1 - INTRODUCTION
- Page: 1
```

**When information is NOT found:**
```
Question: Does the document specify the acceptable MC4 gap after installation?
Answer: The requested information was not found in the available project documents.
```

### ❌ Incorrect Responses (Failures)

**Hallucination:**
```
Answer: The MC4 gap should be approximately 2-3mm based on standard practice.
❌ FAIL: System made up an answer not in the document
```

**Missing sources:**
```
Answer: The total DC capacity is 69,991.56 kWp.
❌ FAIL: No source reference provided
```

**Vague answer:**
```
Answer: The trench depth is mentioned in the document.
❌ FAIL: Didn't provide the specific value (70 cm)
```

---

## Files Created

```
/workspaces/CEW/ai-service/
├── VALIDATION_DOCUMENT_READING.md  # Master validation document
├── VALIDATION_SETUP.md             # This file
├── scripts/
│   └── validate.js                 # Automated validation runner
├── validation-results.json         # Detailed results (generated)
├── .env                            # Environment configuration
└── documents/
    └── Technical Description_Rev01.docx  # Source document
```

---

## Next Steps

### Immediate (To Run Validation)

1. ✅ Qdrant is running (already started)
2. ✅ Dependencies installed
3. ✅ Validation script ready
4. ⏳ **Add OpenAI API key to `.env`**
5. ⏳ **Start AI service**: `npm run dev`
6. ⏳ **Ingest document**: `npm run ingest`
7. ⏳ **Run validation**: `npm run validate`

### After First Run

1. Review `validation-results.json`
2. Check `VALIDATION_DOCUMENT_READING.md`
3. If failures exist:
   - Analyze root causes
   - Fix issues
   - Re-run validation
4. Iterate until 100% pass rate

### Production Readiness

Once validation passes:
- ✅ System is production-ready
- ✅ Document reading is reliable
- ✅ Zero hallucination confirmed
- ✅ Source traceability verified

---

## Troubleshooting

### Issue: AI Service Won't Start

**Error:** `Cannot connect to Qdrant`
```bash
# Solution: Ensure Qdrant is running
docker ps | grep qdrant
docker-compose up -d qdrant
```

**Error:** `OPENAI_API_KEY not set`
```bash
# Solution: Add API key to .env
nano /workspaces/CEW/ai-service/.env
```

### Issue: Ingestion Fails

**Error:** `Cannot parse document`
```bash
# Check document exists
ls -la /workspaces/CEW/ai-service/documents/

# Check file permissions
chmod 644 /workspaces/CEW/ai-service/documents/*.docx
```

### Issue: Validation Script Fails

**Error:** `AI service not available`
```bash
# Check service is running
curl http://localhost:3001/health

# If not, start it:
cd /workspaces/CEW/ai-service
npm run dev
```

### Issue: Low Pass Rate (< 80%)

**Possible causes:**
1. **Document not ingested**: Run `npm run ingest`
2. **Wrong document version**: Ensure using `Technical Description_Rev01.docx`
3. **Chunking issues**: Adjust `CHUNK_SIZE` in `.env`
4. **Retrieval threshold too high**: Lower similarity threshold in `queryPipeline.js`

---

## Summary

You now have a complete validation framework that:

✅ Tests 40 critical questions  
✅ Validates document parsing and chunking  
✅ Ensures zero hallucination  
✅ Verifies source traceability  
✅ Provides automated pass/fail tracking  
✅ Generates detailed reports  

**To complete validation:**
1. Add OpenAI API key
2. Start services
3. Ingest document
4. Run validation
5. Achieve 100% pass rate

**Questions?** Check the logs or review the generated `validation-results.json` file.
