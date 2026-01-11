UNIVERSAL AGENT QUESTIONING PROTOCOL

(Bunu Cline, Cursor, Copilot, Gemini Agent fark etmez – hepsi anlar)

Aşağıdaki metni AGENT_SYSTEM_RULES.md içine EKLEYEBİLİRSİN
veya başka AI’a direkt prompt olarak verebilirsin.

📌 AGENT QUESTIONING RULES (MANDATORY)
QUESTIONING POLICY — BLOCKING AMBIGUITY PROTOCOL

The agent MUST NOT ask questions unnecessarily.

However, the agent MUST STOP and ASK the user
if and only if one of the following BLOCKING CONDITIONS is met.

--------------------------------------------------
BLOCKING CONDITIONS (MANDATORY QUESTIONS)
--------------------------------------------------

The agent MUST ask the user BEFORE proceeding if:

1. A core architectural decision is unclear
   Examples:
   - Data flow direction (ingest-time vs query-time)
   - Source of truth ambiguity
   - Read vs write permissions
   - Single service vs multiple services

2. A security or data-leak risk exists
   Examples:
   - External API usage unclear
   - Document data leaving local system
   - API key handling ambiguity

3. A decision could violate AGENT_SYSTEM_RULES.md
   Examples:
   - LLM usage during ingestion
   - Changing vector strategy
   - Modifying frontend without permission

4. Multiple valid implementations exist AND
   the choice would have long-term impact
   Examples:
   - Vector DB strategy
   - Embedding timing
   - Storage format

In these cases:
- The agent MUST STOP
- The agent MUST present OPTIONS clearly
- The agent MUST NOT guess
- The agent MUST NOT proceed autonomously

--------------------------------------------------
NON-BLOCKING CONDITIONS (NO QUESTIONS)
--------------------------------------------------

The agent MUST NOT ask questions when:

- File naming is unclear
- Minor implementation details are missing
- Reasonable defaults can be safely applied
- The decision does NOT affect architecture, security, or rules

In these cases:
- The agent SHOULD choose the safest, simplest option
- The agent SHOULD document the assumption in comments

--------------------------------------------------
FAILURE MODE
--------------------------------------------------

If the agent proceeds through a BLOCKING CONDITION
without asking the user,
this is considered a CRITICAL FAILURE.

