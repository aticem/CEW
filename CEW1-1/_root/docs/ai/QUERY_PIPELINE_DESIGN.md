# CEW AI ASSISTANT – QUERY PIPELINE DESIGN

**Version:** 1.0  
**Date:** 2026-01-06  
**Purpose:** Detailed design of RAG query pipeline with zero-hallucination architecture

---

## OVERVIEW

The query pipeline transforms user questions into accurate, source-backed answers using Retrieval-Augmented Generation (RAG).

**Core Principles:**
- ✅ Use ONLY top relevant chunks (no full-document retrieval)
- ✅ Explicit "information not found" if no relevant chunks
- ✅ Every answer includes source references (document, page, section)
- ✅ English question → English answer (no language mixing)
- ❌ No confidence-based guessing
- ❌ No hallucination

---

## PIPELINE STAGES

```
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 1: CLASSIFY                             │
│  Query Agent → Classify question category                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 2: RETRIEVE                             │
│  Generate query embedding → Vector search → Rank chunks          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 3: GUARD (PRE)                          │
│  Validate chunk relevance → Check if answer is possible          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─ [FAIL] → Return fallback response
                         │
                         ▼ [PASS]
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 4: GENERATE                             │
│  Build prompt → Call LLM → Parse response                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 5: GUARD (POST)                         │
│  Validate answer quality → Check source presence                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─ [FAIL] → Return fallback response
                         │
                         ▼ [PASS]
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 6: FORMAT                               │
│  Extract sources → Format for frontend → Return response         │
└─────────────────────────────────────────────────────────────────┘
```

---

## STAGE 1: CLASSIFY (Query Agent)

### 1.1 Purpose
Classify the user's question into a category to optimize retrieval and response generation.

**Code Location:** `src/query/agents/queryAgent.js`

---

### 1.2 Question Categories

| Category | Description | Example |
|----------|-------------|---------|
| **Definition / Meaning** | What is X? Define Y. | "What is a DC string?" |
| **Selection / Specification** | Which X should be used? What type of Y? | "Which cable type for DC circuits?" |
| **Technical Value** | What is the value of X? How much Y? | "What is the minimum trench depth?" |
| **Drawing Reference** | Where is X located? Show me Y. | "Where is Inverter 42 on the layout?" |
| **CEW System Data** | What is the progress of X? Show me status of Y. | "What is the DC cable testing progress?" |

---

### 1.3 Classification Process

**Implementation:**
```javascript
// Pseudo-code
async function classifyQuestion(question) {
  // Use simple keyword matching (fast, no LLM call)
  const keywords = {
    'definition': ['what is', 'define', 'meaning of', 'explain'],
    'selection': ['which', 'what type', 'what kind', 'should i use'],
    'technical_value': ['how much', 'how many', 'minimum', 'maximum', 'value of'],
    'drawing': ['where is', 'location of', 'show me', 'layout'],
    'cew_data': ['progress', 'status', 'completed', 'testing results']
  };
  
  const lowerQuestion = question.toLowerCase();
  
  for (const [category, words] of Object.entries(keywords)) {
    if (words.some(word => lowerQuestion.includes(word))) {
      return category;
    }
  }
  
  return 'general'; // Default category
}
```

**Output:**
```javascript
{
  question: "What is the minimum trench depth for DC cables?",
  category: "technical_value",
  domain: "electrical/dc-cable"
}
```

---

## STAGE 2: RETRIEVE (Vector Search)

### 2.1 Retrieval Strategy

**Goal:** Find the most relevant chunks without retrieving entire documents.

**Parameters:**
- **Top K**: Retrieve top 5-10 chunks (configurable)
- **Similarity Threshold**: Minimum cosine similarity score (e.g., 0.7)
- **Metadata Filters**: Filter by folder, document type (optional)

**Code Location:** `src/query/retrieval/retrievalService.js`

---

### 2.2 Query Embedding Generation

**Process:**
1. Take user question
2. Generate embedding using same model as ingest (OpenAI `text-embedding-3-small`)
3. Return 1536-dimensional vector

**Code Location:** `src/query/retrieval/queryEmbedding.js`

**Implementation:**
```javascript
// Pseudo-code
async function generateQueryEmbedding(question) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: question
  });
  
  return response.data[0].embedding;
}
```

---

### 2.3 Vector Search

**Process:**
1. Query vector database with embedding
2. Retrieve top K chunks by cosine similarity
3. Apply similarity threshold filter
4. Return chunks with metadata

**Code Location:** `src/query/retrieval/retrievalService.js`

**Implementation:**
```javascript
// Pseudo-code
async function searchVectorDb(queryEmbedding, topK = 10, threshold = 0.7) {
  const results = await vectorDb.query({
    vector: queryEmbedding,
    topK: topK,
    includeMetadata: true
  });
  
  // Filter by similarity threshold
  const relevantChunks = results.matches.filter(
    match => match.score >= threshold
  );
  
  return relevantChunks;
}
```

**Output:**
```javascript
[
  {
    id: 'doc_1a2b3c_chunk_5',
    score: 0.89,
    metadata: {
      doc_name: '277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf',
      drive_link: 'https://drive.google.com/file/d/1a2b3c4d5e6f/view',
      page: 5,
      section: 'Section 2: Technical Requirements',
      chunk_text: 'Trench depth shall be minimum 800mm from finished ground level...'
    }
  },
  {
    id: 'doc_2b3c4d_chunk_12',
    score: 0.85,
    metadata: {
      doc_name: 'DC Cable Installation Manual Rev 02.pdf',
      drive_link: 'https://drive.google.com/file/d/2b3c4d5e6f/view',
      page: 12,
      section: 'Section 4: Trench Specifications',
      chunk_text: 'For DC cable trenches, minimum depth is 800mm...'
    }
  }
]
```

---

### 2.4 Chunk Ranking

**Process:**
1. Sort chunks by similarity score (descending)
2. Remove duplicates (same document, adjacent chunks)
3. Limit to top 5 chunks (reduce LLM context size)

**Code Location:** `src/query/retrieval/chunkRanker.js`

**Implementation:**
```javascript
// Pseudo-code
function rankAndFilterChunks(chunks, maxChunks = 5) {
  // Sort by score
  chunks.sort((a, b) => b.score - a.score);
  
  // Remove duplicates (same doc, adjacent chunks)
  const uniqueChunks = [];
  const seenDocs = new Set();
  
  for (const chunk of chunks) {
    const docKey = `${chunk.metadata.doc_id}_${chunk.metadata.page}`;
    if (!seenDocs.has(docKey)) {
      uniqueChunks.push(chunk);
      seenDocs.add(docKey);
    }
    
    if (uniqueChunks.length >= maxChunks) break;
  }
  
  return uniqueChunks;
}
```

---

## STAGE 3: GUARD (PRE-VALIDATION)

### 3.1 Purpose
Validate that retrieved chunks are relevant and sufficient to answer the question **before** calling the LLM.

**Code Location:** `src/query/agents/guardAgent.js`

---

### 3.2 Validation Checks

**Check 1: Minimum Chunks**
- At least 1 chunk must be retrieved
- If 0 chunks → FAIL (return fallback)

**Check 2: Minimum Similarity Score**
- Top chunk score must be ≥ 0.7
- If score < 0.7 → FAIL (not relevant enough)

**Check 3: Explicit Information**
- Chunk text must contain keywords from question
- If no keyword match → FAIL (not relevant)

**Check 4: Source Traceability**
- Chunk must have metadata (doc_name, page/section)
- If metadata missing → FAIL (cannot cite source)

---

### 3.3 Implementation

```javascript
// Pseudo-code
function preValidateChunks(question, chunks) {
  // Check 1: Minimum chunks
  if (chunks.length === 0) {
    return {
      pass: false,
      reason: 'NO_CHUNKS_FOUND',
      message: 'No relevant information found in documents.'
    };
  }
  
  // Check 2: Minimum similarity score
  if (chunks[0].score < 0.7) {
    return {
      pass: false,
      reason: 'LOW_RELEVANCE',
      message: 'Retrieved information is not relevant enough.'
    };
  }
  
  // Check 3: Explicit information (keyword match)
  const questionKeywords = extractKeywords(question);
  const chunkTexts = chunks.map(c => c.metadata.chunk_text.toLowerCase()).join(' ');
  const hasKeywords = questionKeywords.some(kw => chunkTexts.includes(kw));
  
  if (!hasKeywords) {
    return {
      pass: false,
      reason: 'NO_KEYWORD_MATCH',
      message: 'Retrieved information does not match question keywords.'
    };
  }
  
  // Check 4: Source traceability
  const hasMetadata = chunks.every(c => 
    c.metadata.doc_name && (c.metadata.page || c.metadata.sheet_name)
  );
  
  if (!hasMetadata) {
    return {
      pass: false,
      reason: 'MISSING_METADATA',
      message: 'Cannot trace source of information.'
    };
  }
  
  return { pass: true };
}

function extractKeywords(question) {
  // Remove stop words, extract key terms
  const stopWords = ['what', 'is', 'the', 'a', 'an', 'for', 'of', 'in'];
  const words = question.toLowerCase().split(/\s+/);
  return words.filter(w => !stopWords.includes(w) && w.length > 3);
}
```

**Output:**
```javascript
// PASS
{ pass: true }

// FAIL
{
  pass: false,
  reason: 'NO_CHUNKS_FOUND',
  message: 'No relevant information found in documents.'
}
```

---

## STAGE 4: GENERATE (LLM Response)

### 4.1 Prompt Structure

**Goal:** Construct a prompt that forces the LLM to:
- Use ONLY provided chunks
- Include source references
- Refuse to guess or infer
- Answer in English

**Code Location:** `src/query/llm/promptBuilder.js`

---

### 4.2 System Prompt

**File:** `src/prompts/system/systemPrompt.txt`

```
You are a technical assistant for construction engineers working on a solar farm project.

STRICT RULES:
1. Answer ONLY using the provided document chunks below.
2. Do NOT use your general knowledge.
3. Do NOT guess, infer, or extrapolate.
4. If the answer is not explicitly stated in the chunks, respond with: "This information was not found in the uploaded documents."
5. ALWAYS cite the source (document name, page number, section) for every statement.
6. Answer in clear, technical English.
7. Be concise and direct.
8. Do NOT make compliance or approval claims (e.g., "this meets standards").

FORMAT:
Answer: [Your answer here]
Source: [Document name (Page X, Section Y)]
```

---

### 4.3 User Prompt Template

**File:** `src/prompts/query/answerPrompt.txt`

```
QUESTION:
{{question}}

RELEVANT DOCUMENT CHUNKS:
{{#chunks}}
---
Document: {{doc_name}}
Page: {{page}}
Section: {{section}}
Content: {{chunk_text}}
---
{{/chunks}}

Provide a concise answer using ONLY the information above. Include source references.
```

---

### 4.4 Prompt Building

**Implementation:**
```javascript
// Pseudo-code
function buildPrompt(question, chunks) {
  const systemPrompt = loadPrompt('system/systemPrompt.txt');
  
  const userPrompt = `
QUESTION:
${question}

RELEVANT DOCUMENT CHUNKS:
${chunks.map((chunk, i) => `
---
Chunk ${i + 1}:
Document: ${chunk.metadata.doc_name}
Page: ${chunk.metadata.page || 'N/A'}
Section: ${chunk.metadata.section || 'N/A'}
Content: ${chunk.metadata.chunk_text}
---
`).join('\n')}

Provide a concise answer using ONLY the information above. Include source references.
`;

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };
}
```

---

### 4.5 LLM Call

**Provider:** OpenAI GPT-4 or Anthropic Claude

**Code Location:** `src/query/llm/llmService.js`

**Implementation:**
```javascript
// Pseudo-code
async function generateAnswer(prompt) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: prompt.messages,
    temperature: 0.0,  // Deterministic, no creativity
    max_tokens: 500,   // Concise answers
    top_p: 1.0
  });
  
  return response.choices[0].message.content;
}
```

**Example LLM Response:**
```
Answer: The minimum trench depth for DC cables is 800mm from finished ground level. Trench width shall be 300mm minimum. Backfill material shall be sand or approved equivalent.

Source: 277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf (Page 5, Section 2: Technical Requirements)
```

---

## STAGE 5: GUARD (POST-VALIDATION)

### 5.1 Purpose
Validate the LLM's response **after** generation to ensure quality and prevent hallucination.

**Code Location:** `src/query/agents/guardAgent.js`

---

### 5.2 Validation Checks

**Check 1: Source Presence**
- Response must contain "Source:" keyword
- If no source → FAIL (LLM did not cite)

**Check 2: Forbidden Language**
- Response must NOT contain:
  - "I think", "I believe", "probably", "maybe", "might"
  - "In my opinion", "generally", "typically"
- If forbidden language → FAIL (LLM is guessing)

**Check 3: Compliance Claims**
- Response must NOT contain:
  - "meets standards", "complies with", "approved"
  - "certified", "passes inspection"
- If compliance claim → FAIL (LLM is making claims)

**Check 4: Fallback Detection**
- If response contains "information was not found" → PASS (valid fallback)

---

### 5.3 Implementation

```javascript
// Pseudo-code
function postValidateAnswer(answer) {
  // Check 1: Source presence
  if (!answer.toLowerCase().includes('source:')) {
    return {
      pass: false,
      reason: 'NO_SOURCE',
      message: 'Answer does not include source reference.'
    };
  }
  
  // Check 2: Forbidden language
  const forbiddenPhrases = [
    'i think', 'i believe', 'probably', 'maybe', 'might',
    'in my opinion', 'generally', 'typically', 'usually'
  ];
  
  const lowerAnswer = answer.toLowerCase();
  const hasForbidden = forbiddenPhrases.some(phrase => lowerAnswer.includes(phrase));
  
  if (hasForbidden) {
    return {
      pass: false,
      reason: 'FORBIDDEN_LANGUAGE',
      message: 'Answer contains uncertain language.'
    };
  }
  
  // Check 3: Compliance claims
  const compliancePhrases = [
    'meets standards', 'complies with', 'approved',
    'certified', 'passes inspection', 'in compliance'
  ];
  
  const hasCompliance = compliancePhrases.some(phrase => lowerAnswer.includes(phrase));
  
  if (hasCompliance) {
    return {
      pass: false,
      reason: 'COMPLIANCE_CLAIM',
      message: 'Answer makes compliance claims.'
    };
  }
  
  // Check 4: Fallback detection (valid)
  if (lowerAnswer.includes('information was not found')) {
    return { pass: true, isFallback: true };
  }
  
  return { pass: true, isFallback: false };
}
```

---

## STAGE 6: FORMAT (Source Extraction)

### 6.1 Purpose
Extract source references from the LLM response and format for frontend display.

**Code Location:** `src/query/sources/sourceExtractor.js`

---

### 6.2 Source Extraction

**Process:**
1. Parse LLM response for "Source:" section
2. Extract document names, page numbers, sections
3. Match with original chunk metadata
4. Format for frontend

**Implementation:**
```javascript
// Pseudo-code
function extractSources(answer, chunks) {
  const sources = [];
  
  // Parse "Source:" section from answer
  const sourceMatch = answer.match(/Source:\s*(.+)/i);
  if (!sourceMatch) return sources;
  
  const sourceText = sourceMatch[1];
  
  // Extract document names from chunks
  for (const chunk of chunks) {
    const docName = chunk.metadata.doc_name;
    
    // Check if document is mentioned in source text
    if (sourceText.includes(docName)) {
      sources.push({
        docName: docName,
        driveLink: chunk.metadata.drive_link,
        page: chunk.metadata.page,
        section: chunk.metadata.section,
        sheetName: chunk.metadata.sheet_name,
        rowNumber: chunk.metadata.row_number
      });
    }
  }
  
  return sources;
}
```

**Output:**
```javascript
[
  {
    docName: '277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf',
    driveLink: 'https://drive.google.com/file/d/1a2b3c4d5e6f/view',
    page: 5,
    section: 'Section 2: Technical Requirements',
    sheetName: null,
    rowNumber: null
  }
]
```

---

### 6.3 Final Response Format

**Code Location:** `src/query/queryController.js`

**Implementation:**
```javascript
// Pseudo-code
function formatFinalResponse(answer, sources, guardResult) {
  return {
    success: true,
    answer: answer,
    sources: sources,
    blocked: !guardResult.pass,
    guardResult: guardResult
  };
}
```

**Output:**
```javascript
{
  success: true,
  answer: "The minimum trench depth for DC cables is 800mm from finished ground level...",
  sources: [
    {
      docName: "277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf",
      driveLink: "https://drive.google.com/file/d/1a2b3c4d5e6f/view",
      page: 5,
      section: "Section 2: Technical Requirements"
    }
  ],
  blocked: false,
  guardResult: { pass: true }
}
```

---

## FALLBACK RESPONSE

### When to Return Fallback

**Trigger Conditions:**
1. No chunks retrieved (Stage 2)
2. Pre-validation fails (Stage 3)
3. Post-validation fails (Stage 5)
4. LLM returns "information not found"

**Fallback Response:**
```javascript
{
  success: true,
  answer: "This information was not found in the uploaded documents.",
  sources: [],
  blocked: false,
  guardResult: { pass: true, isFallback: true }
}
```

---

## HALLUCINATION PREVENTION MECHANISMS

### 1. **Retrieval Constraints**
- Only top 5-10 chunks used (no full documents)
- Similarity threshold (0.7) filters irrelevant chunks
- Chunk ranking removes duplicates

### 2. **Prompt Engineering**
- System prompt explicitly forbids general knowledge
- System prompt requires source citations
- Temperature set to 0.0 (deterministic)

### 3. **Guard Agents**
- **Pre-validation**: Checks chunk relevance before LLM call
- **Post-validation**: Checks answer quality after LLM call
- Forbidden language detection (guessing, uncertainty)
- Compliance claim detection

### 4. **Source Traceability**
- Every chunk has metadata (doc_name, page, section)
- LLM forced to cite sources in response
- Frontend displays sources with Drive links

### 5. **Fallback Response**
- Explicit "information not found" when no answer possible
- No confidence-based guessing
- No partial answers without sources

---

## COMPLETE FLOW EXAMPLE

### Input: User Question
```
"What is the minimum trench depth for DC cables?"
```

### Stage 1: Classify
```javascript
{
  category: "technical_value",
  domain: "electrical/dc-cable"
}
```

### Stage 2: Retrieve
- Generate query embedding
- Search vector DB
- Retrieve top 5 chunks (scores: 0.89, 0.85, 0.82, 0.78, 0.75)

### Stage 3: Guard (Pre)
- ✅ 5 chunks found
- ✅ Top score 0.89 ≥ 0.7
- ✅ Keywords match ("trench", "depth", "dc", "cable")
- ✅ All chunks have metadata
- **Result:** PASS

### Stage 4: Generate
- Build prompt with system rules + chunks
- Call GPT-4 (temperature 0.0)
- LLM response:
  ```
  Answer: The minimum trench depth for DC cables is 800mm from finished ground level.
  Source: 277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf (Page 5, Section 2)
  ```

### Stage 5: Guard (Post)
- ✅ Source present
- ✅ No forbidden language
- ✅ No compliance claims
- **Result:** PASS

### Stage 6: Format
- Extract sources from answer
- Match with chunk metadata
- Format for frontend

### Output: Final Response
```javascript
{
  success: true,
  answer: "The minimum trench depth for DC cables is 800mm from finished ground level.",
  sources: [
    {
      docName: "277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf",
      driveLink: "https://drive.google.com/file/d/1a2b3c4d5e6f/view",
      page: 5,
      section: "Section 2: Technical Requirements"
    }
  ],
  blocked: false
}
```

---

## PERFORMANCE CONSIDERATIONS

### Latency Breakdown
- **Embedding generation**: ~200ms
- **Vector search**: ~100ms
- **Guard (pre)**: ~50ms
- **LLM call**: ~2-5 seconds
- **Guard (post)**: ~50ms
- **Total**: ~3-6 seconds

### Optimization Strategies
- Cache frequent queries (Redis)
- Parallel processing (embedding + metadata lookup)
- Streaming LLM responses (for long answers)

---

## NEXT STEPS

1. Implement query embedding service
2. Implement vector search with ranking
3. Implement guard agents (pre/post validation)
4. Implement prompt builder
5. Implement LLM service
6. Implement source extraction
7. Test with real CEW questions
8. Monitor guard block rate

---

**End of Query Pipeline Design Document**
