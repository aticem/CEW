# AI Data Sources (MVP)

This document defines the allowed data sources for CEW AI Assistant.

## Document Source
- Google Drive is the single source of truth.
- The AI Assistant reads documents from a predefined Drive root folder.
- Access is read-only.
- Documents outside this folder are ignored.

Supported document categories:
- Specifications
- Installation Manuals
- QA/QC documents (ITP, checklists, NCR)
- BOM / BOQ (Excel)
- Legends and symbol definitions
- Drawings (limited support)

Unsupported in MVP:
- DWG / CAD files
- Scanned PDFs (OCR disabled)
- Images and photos

## CEW System Data
The AI Assistant may read (read-only):
- Production tracking data
- QA/QC document status
- NCR and punch list summaries

The AI Assistant must never modify CEW system data.
