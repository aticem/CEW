# Guard Module

The Guard module enforces safety, accuracy, and non-hallucination rules.

Guard checks include:
- Every technical claim has a source
- No speculative or assumption-based language
- No compliance, approval, or handover decisions
- No use of information outside uploaded documents
- OCR limitations are respected

If a check fails, the Guard must:
- Modify the answer to a safe form
- Or refuse to answer explicitly

Default safe response:
"This information was not found in the uploaded documents."
