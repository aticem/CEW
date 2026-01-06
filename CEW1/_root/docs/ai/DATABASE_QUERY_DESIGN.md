# CEW AI ASSISTANT – DATABASE QUERY DESIGN

**Version:** 1.0  
**Date:** 2026-01-06  
**Purpose:** Design for querying CEW production and QA/QC data with safe SQL generation

---

## OVERVIEW

The AI Assistant can answer questions about real-time project data from the CEW database, in addition to document-based questions.

**Data Sources:**
1. **Google Drive Documents** (specifications, manuals, BOMs)
2. **CEW Production Database** (progress tracking, submissions, QA/QC)

**Key Principles:**
- ✅ Read-only database access
- ✅ Safe SQL generation (parameterized queries, no injection)
- ✅ Automatic routing (documents vs. data vs. both)
- ✅ Source traceability (table, record, timestamp)

---

## CEW DATABASE SCHEMA

### 1. Production Modules

**Table: `modules`**
```sql
CREATE TABLE modules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,  -- e.g., 'DC Cable Pulling', 'Panel Installation'
  category VARCHAR(100),        -- e.g., 'electrical', 'civil', 'mechanical'
  created_at TIMESTAMP
);
```

---

### 2. Daily Submissions

**Table: `submissions`**
```sql
CREATE TABLE submissions (
  id SERIAL PRIMARY KEY,
  module_id INTEGER REFERENCES modules(id),
  subcontractor_name VARCHAR(255) NOT NULL,
  submission_date DATE NOT NULL,
  quantity DECIMAL(10, 2),      -- e.g., 500.00 (meters, panels, etc.)
  unit VARCHAR(50),              -- e.g., 'm', 'panels', 'boxes'
  worker_count INTEGER,
  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Example Data:**
```sql
INSERT INTO submissions (module_id, subcontractor_name, submission_date, quantity, unit, worker_count)
VALUES
  (1, 'ElectroCorp', '2026-01-05', 500.00, 'm', 8),
  (1, 'PowerTech', '2026-01-05', 350.00, 'm', 6),
  (2, 'SolarInstall', '2026-01-05', 120.00, 'panels', 12);
```

---

### 3. QA/QC Checklists

**Table: `qaqc_checklists`**
```sql
CREATE TABLE qaqc_checklists (
  id SERIAL PRIMARY KEY,
  checklist_name VARCHAR(255) NOT NULL,
  category VARCHAR(100),        -- e.g., 'electrical', 'civil', 'mechanical'
  subcategory VARCHAR(100),     -- e.g., 'dc-cable', 'lv-termination'
  status VARCHAR(50),            -- 'signed', 'unsigned', 'pending'
  signed_by VARCHAR(255),
  signed_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Example Data:**
```sql
INSERT INTO qaqc_checklists (checklist_name, category, subcategory, status, signed_by, signed_at)
VALUES
  ('DC Cable Installation Checklist #42', 'electrical', 'dc-cable', 'signed', 'John Smith', '2026-01-05 14:30:00'),
  ('LV Termination Checklist #15', 'electrical', 'lv-termination', 'unsigned', NULL, NULL),
  ('Trench Inspection Checklist #8', 'civil', 'trenching', 'signed', 'Jane Doe', '2026-01-04 10:15:00');
```

---

### 4. NCRs (Non-Conformance Reports)

**Table: `ncrs`**
```sql
CREATE TABLE ncrs (
  id SERIAL PRIMARY KEY,
  ncr_number VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  status VARCHAR(50),            -- 'open', 'closed', 'pending'
  raised_by VARCHAR(255),
  raised_at TIMESTAMP,
  closed_by VARCHAR(255),
  closed_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Example Data:**
```sql
INSERT INTO ncrs (ncr_number, title, description, category, status, raised_by, raised_at)
VALUES
  ('NCR-2026-001', 'DC Cable Damage', 'Cable insulation damaged during installation', 'electrical', 'open', 'Inspector A', '2026-01-03 09:00:00'),
  ('NCR-2026-002', 'Trench Depth Non-Compliance', 'Trench depth measured at 750mm instead of 800mm', 'civil', 'closed', 'Inspector B', '2026-01-02 11:30:00');
```

---

## QUERY ROUTING LOGIC

### Decision Tree: Documents vs. Data vs. Both

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER QUESTION                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              QUERY AGENT: CLASSIFY QUESTION                      │
│  Analyze keywords, intent, and context                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─────────────────────────────────────────┐
                         │                                         │
                         ▼                                         ▼
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│   DOCUMENT QUERY                 │    │   DATA QUERY                     │
│   (Specifications, Manuals)      │    │   (Progress, Submissions, QA/QC) │
│                                  │    │                                  │
│   Keywords:                      │    │   Keywords:                      │
│   - "what is"                    │    │   - "how many"                   │
│   - "define"                     │    │   - "how much"                   │
│   - "specification"              │    │   - "progress"                   │
│   - "requirement"                │    │   - "status"                     │
│   - "minimum/maximum value"      │    │   - "completed"                  │
│   - "which type"                 │    │   - "subcontractor"              │
│   - "drawing"                    │    │   - "signed/unsigned"            │
│                                  │    │   - "NCR"                        │
│   Examples:                      │    │                                  │
│   - "What is the minimum trench  │    │   Examples:                      │
│     depth for DC cables?"        │    │   - "How many meters of DC cable │
│   - "Which cable type should be  │    │     have been pulled?"           │
│     used for LV circuits?"       │    │   - "Which subcontractor         │
│                                  │    │     installed the most panels?"  │
│   → Vector DB Search             │    │   - "How many electrical         │
│                                  │    │     checklists are signed?"      │
│                                  │    │                                  │
│                                  │    │   → SQL Query Generation         │
└──────────────────────────────────┘    └──────────────────────────────────┘
                         │                                         │
                         │                                         │
                         └─────────────┬───────────────────────────┘
                                       │
                                       ▼
                         ┌──────────────────────────────────┐
                         │   HYBRID QUERY                   │
                         │   (Both Documents + Data)        │
                         │                                  │
                         │   Keywords:                      │
                         │   - "compare"                    │
                         │   - "verify"                     │
                         │   - "check if"                   │
                         │                                  │
                         │   Examples:                      │
                         │   - "Is the DC cable progress    │
                         │     meeting the specification?"  │
                         │   - "Compare actual trench depth │
                         │     with requirements"           │
                         │                                  │
                         │   → Vector DB + SQL Query        │
                         └──────────────────────────────────┘
```

---

## QUERY CLASSIFICATION

### Classification Rules

**Code Location:** `src/query/agents/queryAgent.js`

**Implementation:**
```javascript
// Pseudo-code
function classifyQuerySource(question) {
  const lowerQuestion = question.toLowerCase();
  
  // Data query keywords
  const dataKeywords = [
    'how many', 'how much', 'total', 'count', 'sum',
    'progress', 'status', 'completed', 'finished',
    'subcontractor', 'worker', 'submission',
    'signed', 'unsigned', 'pending',
    'ncr', 'non-conformance', 'inspection'
  ];
  
  // Document query keywords
  const documentKeywords = [
    'what is', 'define', 'meaning of', 'explain',
    'specification', 'requirement', 'standard',
    'minimum', 'maximum', 'value of',
    'which type', 'what kind', 'should i use',
    'drawing', 'layout', 'location'
  ];
  
  // Hybrid query keywords
  const hybridKeywords = [
    'compare', 'verify', 'check if', 'validate',
    'meets', 'complies', 'according to'
  ];
  
  // Check for hybrid first
  if (hybridKeywords.some(kw => lowerQuestion.includes(kw))) {
    return 'HYBRID';
  }
  
  // Check for data query
  if (dataKeywords.some(kw => lowerQuestion.includes(kw))) {
    return 'DATA';
  }
  
  // Check for document query
  if (documentKeywords.some(kw => lowerQuestion.includes(kw))) {
    return 'DOCUMENT';
  }
  
  // Default to document query
  return 'DOCUMENT';
}
```

**Output:**
```javascript
{
  question: "How many meters of DC cable have been pulled so far?",
  source: "DATA",
  category: "progress_tracking"
}
```

---

## SAFE SQL QUERY GENERATION

### 1. Query Templates

**Code Location:** `src/query/database/queryBuilder.js`

**Predefined Templates:**
```javascript
const QUERY_TEMPLATES = {
  // Total quantity by module
  'total_quantity_by_module': {
    sql: `
      SELECT 
        m.name AS module_name,
        SUM(s.quantity) AS total_quantity,
        s.unit
      FROM submissions s
      JOIN modules m ON s.module_id = m.id
      WHERE m.name ILIKE $1
      GROUP BY m.name, s.unit
    `,
    params: ['module_name']
  },
  
  // Subcontractor performance
  'subcontractor_performance': {
    sql: `
      SELECT 
        s.subcontractor_name,
        m.name AS module_name,
        SUM(s.quantity) AS total_quantity,
        s.unit,
        COUNT(s.id) AS submission_count
      FROM submissions s
      JOIN modules m ON s.module_id = m.id
      WHERE m.name ILIKE $1
      GROUP BY s.subcontractor_name, m.name, s.unit
      ORDER BY total_quantity DESC
    `,
    params: ['module_name']
  },
  
  // QA/QC checklist status
  'qaqc_checklist_status': {
    sql: `
      SELECT 
        category,
        status,
        COUNT(*) AS count
      FROM qaqc_checklists
      WHERE category ILIKE $1
      GROUP BY category, status
    `,
    params: ['category']
  },
  
  // NCR status
  'ncr_status': {
    sql: `
      SELECT 
        status,
        COUNT(*) AS count
      FROM ncrs
      WHERE category ILIKE $1
      GROUP BY status
    `,
    params: ['category']
  }
};
```

---

### 2. Query Template Selection

**Process:**
1. Analyze user question
2. Extract entities (module name, category, subcontractor)
3. Select appropriate template
4. Extract parameters from question
5. Generate parameterized SQL query

**Implementation:**
```javascript
// Pseudo-code
function selectQueryTemplate(question, classification) {
  const lowerQuestion = question.toLowerCase();
  
  // Total quantity queries
  if (lowerQuestion.includes('how many') || lowerQuestion.includes('how much')) {
    if (lowerQuestion.includes('subcontractor')) {
      return {
        template: 'subcontractor_performance',
        params: extractModuleName(question)
      };
    } else {
      return {
        template: 'total_quantity_by_module',
        params: extractModuleName(question)
      };
    }
  }
  
  // QA/QC queries
  if (lowerQuestion.includes('checklist') || lowerQuestion.includes('signed')) {
    return {
      template: 'qaqc_checklist_status',
      params: extractCategory(question)
    };
  }
  
  // NCR queries
  if (lowerQuestion.includes('ncr') || lowerQuestion.includes('non-conformance')) {
    return {
      template: 'ncr_status',
      params: extractCategory(question)
    };
  }
  
  return null; // No template found
}

function extractModuleName(question) {
  // Extract module name from question
  const moduleKeywords = {
    'dc cable': 'DC Cable Pulling',
    'panel': 'Panel Installation',
    'lv cable': 'LV Cable Pulling',
    'trench': 'Trench Excavation'
  };
  
  for (const [keyword, moduleName] of Object.entries(moduleKeywords)) {
    if (question.toLowerCase().includes(keyword)) {
      return { module_name: moduleName };
    }
  }
  
  return { module_name: '%' }; // Wildcard for all modules
}

function extractCategory(question) {
  // Extract category from question
  const categoryKeywords = {
    'electrical': 'electrical',
    'civil': 'civil',
    'mechanical': 'mechanical'
  };
  
  for (const [keyword, category] of Object.entries(categoryKeywords)) {
    if (question.toLowerCase().includes(keyword)) {
      return { category: category };
    }
  }
  
  return { category: '%' }; // Wildcard for all categories
}
```

---

### 3. SQL Execution (Read-Only)

**Code Location:** `src/query/database/cewDbClient.js`

**Implementation:**
```javascript
// Pseudo-code
const { Pool } = require('pg');

// Read-only connection
const pool = new Pool({
  connectionString: process.env.CEW_DATABASE_URL_READONLY,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

async function executeQuery(template, params) {
  const client = await pool.connect();
  
  try {
    // Set read-only transaction
    await client.query('SET TRANSACTION READ ONLY');
    
    // Execute parameterized query
    const result = await client.query(template.sql, Object.values(params));
    
    return {
      success: true,
      rows: result.rows,
      rowCount: result.rowCount
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  } finally {
    client.release();
  }
}
```

---

### 4. SQL Injection Prevention

**Security Measures:**

1. **Parameterized Queries Only**
   - Never concatenate user input into SQL
   - Use `$1`, `$2`, etc. placeholders
   - PostgreSQL driver handles escaping

2. **Predefined Templates**
   - All SQL queries are predefined
   - No dynamic SQL generation from user input
   - Limited to safe operations (SELECT only)

3. **Read-Only Connection**
   - Database user has SELECT-only permissions
   - No INSERT, UPDATE, DELETE, DROP allowed
   - Transaction set to READ ONLY

4. **Input Validation**
   - Validate extracted parameters
   - Whitelist allowed values (module names, categories)
   - Reject suspicious input

**Example:**
```javascript
// SAFE (parameterized)
const query = 'SELECT * FROM submissions WHERE module_id = $1';
const params = [moduleId];
await client.query(query, params);

// UNSAFE (concatenation) - NEVER DO THIS
const query = `SELECT * FROM submissions WHERE module_id = ${moduleId}`;
await client.query(query);
```

---

## DATA QUERY PIPELINE

### Stage 1: Classify
- Determine query source: DATA, DOCUMENT, or HYBRID
- Extract entities (module name, category, subcontractor)

### Stage 2: Select Template
- Choose appropriate SQL template
- Extract parameters from question

### Stage 3: Execute Query
- Connect to read-only database
- Execute parameterized query
- Return structured results

### Stage 4: Format Results
- Convert SQL results to natural language
- Include source (table, record count, timestamp)

### Stage 5: Generate Answer (LLM)
- Build prompt with SQL results
- Call LLM to format as natural language
- Include source references

---

## EXAMPLE QUERIES

### Example 1: Total DC Cable Pulled

**Question:**
```
"How many meters of DC cable have been pulled so far?"
```

**Classification:**
```javascript
{
  source: "DATA",
  category: "progress_tracking"
}
```

**Template Selection:**
```javascript
{
  template: "total_quantity_by_module",
  params: { module_name: "DC Cable Pulling" }
}
```

**SQL Query:**
```sql
SELECT 
  m.name AS module_name,
  SUM(s.quantity) AS total_quantity,
  s.unit
FROM submissions s
JOIN modules m ON s.module_id = m.id
WHERE m.name ILIKE 'DC Cable Pulling'
GROUP BY m.name, s.unit
```

**SQL Result:**
```javascript
{
  rows: [
    { module_name: 'DC Cable Pulling', total_quantity: 850.00, unit: 'm' }
  ],
  rowCount: 1
}
```

**LLM Prompt:**
```
QUESTION:
How many meters of DC cable have been pulled so far?

DATABASE QUERY RESULT:
Module: DC Cable Pulling
Total Quantity: 850.00 m

Format this data into a natural language answer. Include the source (CEW Database, table: submissions).
```

**LLM Response:**
```
Answer: A total of 850 meters of DC cable have been pulled so far.

Source: CEW Database (table: submissions, module: DC Cable Pulling)
```

---

### Example 2: Subcontractor Performance

**Question:**
```
"Which subcontractor installed the most panels?"
```

**Classification:**
```javascript
{
  source: "DATA",
  category: "subcontractor_performance"
}
```

**Template Selection:**
```javascript
{
  template: "subcontractor_performance",
  params: { module_name: "Panel Installation" }
}
```

**SQL Query:**
```sql
SELECT 
  s.subcontractor_name,
  m.name AS module_name,
  SUM(s.quantity) AS total_quantity,
  s.unit,
  COUNT(s.id) AS submission_count
FROM submissions s
JOIN modules m ON s.module_id = m.id
WHERE m.name ILIKE 'Panel Installation'
GROUP BY s.subcontractor_name, m.name, s.unit
ORDER BY total_quantity DESC
```

**SQL Result:**
```javascript
{
  rows: [
    { subcontractor_name: 'SolarInstall', module_name: 'Panel Installation', total_quantity: 1250, unit: 'panels', submission_count: 15 },
    { subcontractor_name: 'PanelPro', module_name: 'Panel Installation', total_quantity: 980, unit: 'panels', submission_count: 12 }
  ],
  rowCount: 2
}
```

**LLM Response:**
```
Answer: SolarInstall installed the most panels with a total of 1,250 panels across 15 submissions. PanelPro is second with 980 panels.

Source: CEW Database (table: submissions, module: Panel Installation)
```

---

### Example 3: QA/QC Checklist Status

**Question:**
```
"How many electrical checklists are signed?"
```

**Classification:**
```javascript
{
  source: "DATA",
  category: "qaqc_status"
}
```

**Template Selection:**
```javascript
{
  template: "qaqc_checklist_status",
  params: { category: "electrical" }
}
```

**SQL Query:**
```sql
SELECT 
  category,
  status,
  COUNT(*) AS count
FROM qaqc_checklists
WHERE category ILIKE 'electrical'
GROUP BY category, status
```

**SQL Result:**
```javascript
{
  rows: [
    { category: 'electrical', status: 'signed', count: 42 },
    { category: 'electrical', status: 'unsigned', count: 8 },
    { category: 'electrical', status: 'pending', count: 3 }
  ],
  rowCount: 3
}
```

**LLM Response:**
```
Answer: There are 42 signed electrical checklists. Additionally, 8 are unsigned and 3 are pending.

Source: CEW Database (table: qaqc_checklists, category: electrical)
```

---

## HYBRID QUERIES (Documents + Data)

### Example: Verify Compliance

**Question:**
```
"Is the DC cable progress meeting the specification?"
```

**Classification:**
```javascript
{
  source: "HYBRID",
  category: "compliance_check"
}
```

**Process:**
1. **Document Query**: Retrieve specification for DC cable progress
   - Vector search: "DC cable installation specification"
   - Extract target: "5,000 meters by end of January"

2. **Data Query**: Retrieve actual DC cable progress
   - SQL query: Total DC cable pulled
   - Result: 850 meters

3. **LLM Synthesis**: Compare specification vs. actual
   - Prompt includes both document chunks and SQL results
   - LLM generates comparison answer

**LLM Response:**
```
Answer: According to the specification (Document: DC Cable Installation Plan Rev 02, Page 8), the target is 5,000 meters of DC cable by end of January. Current progress shows 850 meters pulled (CEW Database, table: submissions). This represents 17% of the target.

Source: 
- Document: DC Cable Installation Plan Rev 02 (Page 8, Section 3: Timeline)
- CEW Database (table: submissions, module: DC Cable Pulling)
```

---

## SOURCE TRACEABILITY FOR DATA QUERIES

### Metadata Format

**For SQL Results:**
```javascript
{
  docName: "CEW Database",
  table: "submissions",
  module: "DC Cable Pulling",
  recordCount: 15,
  queryTimestamp: "2026-01-06T19:45:00Z"
}
```

**Frontend Display:**
```
📊 Source: CEW Database
   Table: submissions
   Module: DC Cable Pulling
   Records: 15
   Queried: 2026-01-06 19:45
```

---

## ERROR HANDLING

### No Results Found
```javascript
{
  success: true,
  answer: "No data found for this query. Please check if the module name or category is correct.",
  sources: [],
  blocked: false
}
```

### SQL Error
```javascript
{
  success: false,
  error: "Database query failed. Please try again or contact support.",
  sources: []
}
```

### Invalid Template
```javascript
{
  success: true,
  answer: "I cannot answer this question using the available data. Please rephrase or ask about documents instead.",
  sources: [],
  blocked: false
}
```

---

## PERFORMANCE CONSIDERATIONS

### Query Optimization
- Index on frequently queried columns (module_id, category, status)
- Limit result sets (TOP 100)
- Query timeout (5 seconds)

### Caching
- Cache frequent queries (Redis)
- Cache for 5 minutes (data changes frequently)
- Invalidate on new submissions

### Connection Pooling
- Max 10 connections
- Idle timeout: 30 seconds
- Connection timeout: 5 seconds

---

## NEXT STEPS

1. Define all SQL query templates
2. Implement query template selection logic
3. Implement safe SQL execution with parameterized queries
4. Implement result formatting
5. Test with real CEW data
6. Monitor query performance and errors

---

**End of Database Query Design Document**
