# Ingest Module

This module is responsible for ingesting project documents
from Google Drive into a searchable internal representation.

Ingest responsibilities:
- List files from the configured Drive folder
- Classify document types (PDF, Excel, drawing, scanned)
- Extract text content where available
- Split content into traceable chunks
- Attach source metadata (document name, page, section, sheet)

Ingest must NOT:
- Perform OCR in MVP
- Interpret drawings or extract dimensions from images
- Modify or upload documents
- Generate answers or summaries

Behaviour is defined in:
- docs/ai/INGEST_FLOW.md
