# Query Module

This module routes user questions to the correct information source.

Question categories:
- DOC: Answered using Google Drive documents
- CEW_DATA: Answered using CEW system data (read-only)
- HYBRID: Combination of documents and CEW data (limited in MVP)
- REFUSE: Questions outside allowed scope

Query responsibilities:
- Classify the incoming question
- Retrieve relevant document chunks or CEW metrics
- Prepare evidence for answer generation

Query must NOT:
- Calculate values independently
- Guess or infer missing information
- Generate final answers without sources

Routing logic is defined in:
- docs/ai/AGENT_ROLES.md
