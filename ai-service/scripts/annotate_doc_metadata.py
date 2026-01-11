#!/usr/bin/env python3
"""
Annotate existing ChromaDB records with document-level metadata (no re-embedding).

Adds (per record):
- doc_type: pdf | excel | word | unknown
- pdf_kind (pdf only): TEXT_PDF | DRAWING_PDF | SCANNED_PDF | UNKNOWN

This is useful for:
- ingestion quality reporting
- multi-doc retrieval tuning (metadata filters)

Usage:
  cd ai-service
  .\\venv\\Scripts\\Activate.ps1
  python scripts/annotate_doc_metadata.py
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, Tuple

import pdfplumber

# Windows console encoding safety
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.chroma_service import get_collection  # noqa: E402
from app.config import DOCUMENTS_DIR  # noqa: E402


def classify_doc_type(doc_name: str) -> str:
    s = (doc_name or "").lower()
    if s.endswith(".pdf"):
        return "pdf"
    if s.endswith(".xlsx") or s.endswith(".xls"):
        return "excel"
    if s.endswith(".docx"):
        return "word"
    return "unknown"


def classify_pdf_kind(pdf_path: Path, sample_pages: int = 25) -> str:
    """
    Classify PDF based on sampled text density (no OCR).
    - TEXT_PDF: most sampled pages have >200 chars
    - SCANNED_PDF: very few sampled pages have >200 chars
    - DRAWING_PDF: in-between
    """
    try:
        with pdfplumber.open(pdf_path) as pdf:
            pages = pdf.pages or []
            total = len(pages)
            if total == 0:
                return "UNKNOWN"
            take = min(sample_pages, total)
            text_pages = 0
            for i in range(take):
                t = pages[i].extract_text() or ""
                if len(t.strip()) > 200:
                    text_pages += 1
            ratio = text_pages / take if take else 0.0
            if ratio > 0.8:
                return "TEXT_PDF"
            if ratio < 0.2:
                return "SCANNED_PDF"
            return "DRAWING_PDF"
    except Exception:
        return "UNKNOWN"


def main() -> int:
    collection = get_collection()

    # Load all ids + metadatas
    res = collection.get(limit=100000, include=["metadatas"])
    ids = res.get("ids") or []
    metas = res.get("metadatas") or []

    if not ids:
        print("No documents found in ChromaDB. Run scripts/ingest.py first.")
        return 1

    # Document-level classification cache
    doc_cache: Dict[str, Tuple[str, str]] = {}

    # Precompute classification per doc_name
    doc_names = sorted({str(m.get("doc_name") or "") for m in metas if m and m.get("doc_name")})
    for dn in doc_names:
        dt = classify_doc_type(dn)
        pk = ""
        if dt == "pdf":
            pdf_path = DOCUMENTS_DIR / dn
            pk = classify_pdf_kind(pdf_path) if pdf_path.exists() else "UNKNOWN"
        doc_cache[dn] = (dt, pk)

    # Stats
    by_kind = defaultdict(int)

    # Build update batches
    batch_ids = []
    batch_metas = []

    def flush():
        nonlocal batch_ids, batch_metas
        if not batch_ids:
            return
        collection.update(ids=batch_ids, metadatas=batch_metas)
        batch_ids = []
        batch_metas = []

    for doc_id, meta in zip(ids, metas):
        meta = dict(meta or {})
        dn = str(meta.get("doc_name") or "")
        dt, pk = doc_cache.get(dn, ("unknown", ""))
        meta["doc_type"] = dt
        if dt == "pdf":
            meta["pdf_kind"] = pk or "UNKNOWN"
            by_kind[meta["pdf_kind"]] += 1
        batch_ids.append(doc_id)
        batch_metas.append(meta)
        if len(batch_ids) >= 200:
            flush()
    flush()

    print(f"Updated {len(ids)} records with doc_type/pdf_kind metadata.")
    if by_kind:
        print("PDF kind distribution (records):")
        for k in sorted(by_kind.keys()):
            print(f"- {k}: {by_kind[k]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

