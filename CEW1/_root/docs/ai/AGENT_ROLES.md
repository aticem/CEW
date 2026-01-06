# CEW AI ASSISTANT – QUERY FLOW (RUNTIME EXECUTION)

This document defines the exact runtime flow
when a user submits a question to the CEW AI Assistant.

No step may be skipped.

---

## 1. USER INPUT

The flow starts when the user submits a question via the AI Assistant UI.

The input includes:
- User question (text)
- Project context
- Optional document filter (e.g. QA/QC, BOM, Drawings)

---

## 2. QUERY AGENT – QUESTION CLASSIFICATION

The Query Agent classifies the question into one category:

A. Definition / Meaning  
B. Selection / Specification  
C. Technical Value  
D. Drawing Reference  
E. CEW System Data  

If the question does not match any category:
- The query is rejected

---

## 3. DOCUMENT RETRIEVAL

Based on the classification, the system retrieves
ONLY relevant chunks from the Vector DB.

Rules:
- Minimum chunks required to answer the question
- No full-document retrieval
- No cross-discipline mixing

Retrieved chunks MUST include metadata:
- document name
- page number
- section title

---

## 4. GUARD AGENT – PRE-ANSWER VALIDATION

Before sending anything to the LLM, the Guard Agent checks:

- Is there at least one relevant chunk?
- Is the information explicit?
- Does the answer require inference or guessing?
- Is the source clearly traceable?

If ANY check fails:
- Skip the LLM
- Return fallback response

---

## 5. LLM RESPONSE GENERATION

Only validated chunks are sent to the LLM,
together with the QUERY_PROMPT rules.

The LLM:
- Generates a concise technical answer
- Uses ONLY the provided chunks
- Follows the mandatory answer format

---

## 6. POST-ANSWER GUARD CHECK

After the LLM response:

The Guard Agent verifies:
- Source is present
- No forbidden language is used
- No compliance or approval claims exist

If validation fails:
- Response is rejected
- Fallback response is returned

---

## 7. FINAL RESPONSE TO USER

The final response is returned to the UI with:
- Answer
- Source references

If no valid answer exists:
- The fallback response is returned

---

## 8. FALLBACK RESPONSE (MANDATORY)

Answer:
This information was not found in the uploaded documents.

Source:
Not available

---

## 9. CORE RUNTIME PRINCIPLE

No document → No answer  
No source → No answer  
No certainty → No answer
