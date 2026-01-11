#!/usr/bin/env python3
"""
Generate an ingestion quality report from the current ChromaDB collection.

Outputs:
- ai-service/INGEST_QUALITY_REPORT.md
- ai-service/scripts/ingest_quality_report.json

Usage:
  cd ai-service
  .\\venv\\Scripts\\Activate.ps1
  python scripts/generate_ingest_quality_report.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.chroma_service import get_collection  # noqa: E402


ROOT = Path(__file__).parent.parent
OUT_MD = ROOT / "INGEST_QUALITY_REPORT.md"
OUT_JSON = Path(__file__).parent / "ingest_quality_report.json"


def is_structured(text: str) -> bool:
    t = text or ""
    return ("SOURCE:" in t) and (("DATA:" in t) or ("CONTENT:" in t))


@dataclass
class DocStats:
    doc_name: str
    doc_type: str | None = None
    pdf_kind: str | None = None
    chunks: int = 0
    structured_chunks: int = 0
    avg_chars: float = 0.0
    sample_snippets: list[str] | None = None

    @property
    def structured_pct(self) -> float:
        return (self.structured_chunks / self.chunks * 100.0) if self.chunks else 0.0


def main() -> int:
    col = get_collection()
    total = int(col.count() or 0)
    print(f"Chroma collection count: {total}")

    if total == 0:
        print("No documents in collection. Run scripts/ingest.py first.")
        return 1

    # Pull all documents/metadatas (small enough for local usage; if it grows, we can batch).
    res = col.get(limit=max(1000, total), include=["documents", "metadatas"])
    docs = res.get("documents") or []
    metas = res.get("metadatas") or []

    by_doc: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "chunks": 0,
        "structured_chunks": 0,
        "chars_sum": 0,
        "sample_snippets": [],
        "doc_type": None,
        "pdf_kind": None,
    })

    for text, meta in zip(docs, metas):
        doc_name = str((meta or {}).get("doc_name") or "UNKNOWN")
        entry = by_doc[doc_name]
        entry["chunks"] += 1
        entry["chars_sum"] += len(text or "")
        if is_structured(text or ""):
            entry["structured_chunks"] += 1

        # Keep first few samples
        if len(entry["sample_snippets"]) < 3:
            snippet = (text or "").replace("\n", " ")[:220]
            entry["sample_snippets"].append(snippet)

        # Capture representative metadata (first occurrence)
        if entry["doc_type"] is None:
            entry["doc_type"] = (meta or {}).get("doc_type")
        if entry["pdf_kind"] is None:
            entry["pdf_kind"] = (meta or {}).get("pdf_kind")

    stats: list[DocStats] = []
    for doc_name, entry in by_doc.items():
        chunks = int(entry["chunks"])
        avg_chars = (entry["chars_sum"] / chunks) if chunks else 0.0
        stats.append(DocStats(
            doc_name=doc_name,
            doc_type=entry["doc_type"],
            pdf_kind=entry["pdf_kind"],
            chunks=chunks,
            structured_chunks=int(entry["structured_chunks"]),
            avg_chars=avg_chars,
            sample_snippets=list(entry["sample_snippets"]),
        ))

    stats.sort(key=lambda s: s.chunks, reverse=True)

    # Write JSON (for tooling)
    OUT_JSON.write_text(
        json.dumps(
            {
                "total_chunks": total,
                "documents": [asdict(s) | {"structured_pct": s.structured_pct} for s in stats],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # Write Markdown report
    lines: list[str] = []
    lines.append("# INGEST QUALITY REPORT")
    lines.append("")
    lines.append(f"- Total chunks in Chroma: **{total}**")
    lines.append(f"- Total source documents: **{len(stats)}**")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| doc_name | doc_type | pdf_kind | chunks | structured% | avg_chars | risk_flags |")
    lines.append("|---|---:|---:|---:|---:|---:|---|")

    for s in stats:
        risk = []
        if (s.doc_type or "").lower() == "pdf":
            if (s.pdf_kind or "") in ("SCANNED_PDF", "DRAWING_PDF"):
                risk.append("SCANNED_OR_DRAWING_RISK")
        if s.structured_pct < 50:
            risk.append("LOW_STRUCTURED_RATIO")
        risk_flags = ", ".join(risk) if risk else ""

        lines.append(
            f"| {s.doc_name} | {s.doc_type or ''} | {s.pdf_kind or ''} | {s.chunks} | {s.structured_pct:.0f}% | {s.avg_chars:.0f} | {risk_flags} |"
        )

    lines.append("")
    lines.append("## Details (samples)")
    lines.append("")

    for s in stats:
        lines.append(f"### {s.doc_name}")
        lines.append("")
        lines.append(f"- doc_type: `{s.doc_type}`")
        if s.doc_type == "pdf":
            lines.append(f"- pdf_kind: `{s.pdf_kind}`")
        lines.append(f"- chunks: `{s.chunks}`")
        lines.append(f"- structured: `{s.structured_chunks}/{s.chunks}` ({s.structured_pct:.0f}%)")
        lines.append(f"- avg_chars_per_chunk: `{s.avg_chars:.0f}`")
        lines.append("")
        lines.append("Sample snippets:")
        for sn in (s.sample_snippets or []):
            lines.append(f"- `{sn}`")
        lines.append("")

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote: {OUT_MD}")
    print(f"Wrote: {OUT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""
Generate an ingestion quality report from the current ChromaDB collection.

Outputs:
- ai-service/INGEST_QUALITY_REPORT.md

The report is meant to answer:
- Which documents were indexed?
- How many chunks per doc?
- Which PDFs look like scanned/drawing-heavy (no OCR)?
- Is content mostly structured?

Usage:
  cd ai-service
  .\\venv\\Scripts\\Activate.ps1
  python scripts/generate_ingest_quality_report.py
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# Windows console encoding safety
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.chroma_service import get_collection, get_collection_stats  # noqa: E402
from app.config import DOCUMENTS_DIR  # noqa: E402


OUT_MD = Path(__file__).parent.parent / "INGEST_QUALITY_REPORT.md"


def main() -> int:
    stats = get_collection_stats()
    total = int(stats.get("count", 0) or 0)
    if total <= 0:
        OUT_MD.write_text(
            "# Ingest Quality Report\n\nNo documents found in ChromaDB. Run `python scripts/ingest.py` first.\n",
            encoding="utf-8",
        )
        print(f"Wrote {OUT_MD} (empty).")
        return 1

    col = get_collection()
    res = col.get(limit=200000, include=["documents", "metadatas"])
    docs = res.get("documents") or []
    metas = res.get("metadatas") or []

    per_doc = defaultdict(lambda: {"count": 0, "structured": 0, "doc_type": None, "pdf_kind": None, "samples": []})

    for text, meta in zip(docs, metas):
        meta = meta or {}
        dn = str(meta.get("doc_name") or "UNKNOWN")
        entry = per_doc[dn]
        entry["count"] += 1

        dt = meta.get("doc_type")
        pk = meta.get("pdf_kind")
        if dt and entry["doc_type"] is None:
            entry["doc_type"] = dt
        if pk and entry["pdf_kind"] is None:
            entry["pdf_kind"] = pk

        t = text or ""
        if "SOURCE:" in t and ("DATA:" in t or "CONTENT:" in t):
            entry["structured"] += 1

        if len(entry["samples"]) < 2:
            entry["samples"].append(t[:180].replace("\n", " "))

    # Compute risk flags
    pdf_risk = set()
    for dn, e in per_doc.items():
        if (e.get("doc_type") == "pdf") and (e.get("pdf_kind") in {"SCANNED_PDF", "DRAWING_PDF", "UNKNOWN"}):
            pdf_risk.add(dn)

    # Files present on disk (documents folder)
    disk_files = {p.name for p in DOCUMENTS_DIR.iterdir() if p.is_file()}
    indexed_files = set(per_doc.keys())
    missing_on_disk = sorted(indexed_files - disk_files)
    not_indexed = sorted(disk_files - indexed_files)

    now = datetime.now().isoformat(timespec="seconds")
    lines = []
    lines.append("# Ingest Quality Report\n")
    lines.append(f"- Generated at: {now}\n")
    lines.append(f"- Chroma collection: `{stats.get('name')}`\n")
    lines.append(f"- Total chunks: **{total}**\n")

    if missing_on_disk:
        lines.append("\n## Warning: Indexed but not present on disk\n")
        for dn in missing_on_disk:
            lines.append(f"- {dn}\n")

    if not_indexed:
        lines.append("\n## Warning: Present on disk but not indexed\n")
        for dn in not_indexed:
            lines.append(f"- {dn}\n")

    lines.append("\n## Documents summary\n")
    lines.append("| doc_name | doc_type | pdf_kind | chunks | structured% | flags |\n")
    lines.append("|---|---:|---:|---:|---:|---|\n")

    for dn in sorted(per_doc.keys()):
        e = per_doc[dn]
        cnt = e["count"]
        structured_pct = (e["structured"] / cnt * 100.0) if cnt else 0.0
        dt = e.get("doc_type") or ""
        pk = e.get("pdf_kind") or ""
        flags = []
        if dn in pdf_risk:
            flags.append("SCANNED_OR_DRAWING_RISK")
        lines.append(
            f"| {dn} | {dt} | {pk} | {cnt} | {structured_pct:.0f}% | {', '.join(flags)} |\n"
        )

    lines.append("\n## Samples (first 2 chunks per document)\n")
    for dn in sorted(per_doc.keys()):
        e = per_doc[dn]
        lines.append(f"\n### {dn}\n")
        for s in e["samples"]:
            lines.append(f"- `{s}`\n")

    OUT_MD.write_text("".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD}")
    return 0


if __name__ == \"__main__\":
    raise SystemExit(main())

