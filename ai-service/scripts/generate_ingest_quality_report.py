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

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.config import DOCUMENTS_DIR  # noqa: E402
from app.services.chroma_service import get_collection, get_collection_stats  # noqa: E402


OUT_MD = ROOT / "INGEST_QUALITY_REPORT.md"
OUT_JSON = Path(__file__).parent / "ingest_quality_report.json"


def _is_structured(text: str) -> bool:
    t = text or ""
    return ("SOURCE:" in t) and (("DATA:" in t) or ("CONTENT:" in t))

def _infer_doc_type(doc_name: str, meta_doc_type: str | None) -> str | None:
    if meta_doc_type:
        return meta_doc_type
    n = (doc_name or "").lower()
    if n.endswith(".pdf"):
        return "pdf"
    if n.endswith(".docx") or n.endswith(".doc"):
        return "word"
    if n.endswith(".xlsx") or n.endswith(".xls"):
        return "excel"
    return None


def main() -> int:
    stats = get_collection_stats()
    total = int(stats.get("count", 0) or 0)
    if total <= 0:
        OUT_MD.write_text(
            "# INGEST QUALITY REPORT\n\nNo documents found in ChromaDB. Run `python scripts/ingest.py` first.\n",
            encoding="utf-8",
        )
        print(f"Wrote {OUT_MD} (empty).")
        return 1

    col = get_collection()
    res = col.get(limit=max(1000, total), include=["documents", "metadatas"])
    docs = res.get("documents") or []
    metas = res.get("metadatas") or []

    per_doc = defaultdict(
        lambda: {
            "count": 0,
            "structured": 0,
            "doc_type": None,
            "pdf_kind": None,
            "avg_chars_sum": 0,
            "samples": [],
        }
    )

    for text, meta in zip(docs, metas):
        meta = meta or {}
        dn = str(meta.get("doc_name") or "UNKNOWN")
        entry = per_doc[dn]
        entry["count"] += 1
        entry["avg_chars_sum"] += len(text or "")

        if entry["doc_type"] is None:
            entry["doc_type"] = _infer_doc_type(dn, meta.get("doc_type"))
        if entry["pdf_kind"] is None:
            entry["pdf_kind"] = meta.get("pdf_kind")

        if _is_structured(text or ""):
            entry["structured"] += 1

        if len(entry["samples"]) < 3:
            entry["samples"].append((text or "").replace("\n", " ")[:220])

    indexed_doc_names = set(per_doc.keys())
    on_disk_doc_names = {
        p.name
        for p in DOCUMENTS_DIR.glob("*")
        if p.is_file() and not p.name.startswith(".") and p.name != ".gitkeep"
    }
    missing_on_disk = sorted(indexed_doc_names - on_disk_doc_names)
    not_indexed = sorted(on_disk_doc_names - indexed_doc_names)

    # Risk flags
    pdf_risk = set()
    low_structured = set()
    for dn, e in per_doc.items():
        cnt = int(e["count"])
        structured_pct = (int(e["structured"]) / cnt * 100.0) if cnt else 0.0
        if structured_pct < 50.0:
            low_structured.add(dn)
        if (e.get("doc_type") or "").lower() == "pdf":
            if (e.get("pdf_kind") or "") in ("SCANNED_PDF", "DRAWING_PDF"):
                pdf_risk.add(dn)

    # JSON output (for tooling)
    json_payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "collection": stats.get("name"),
        "total_chunks": total,
        "indexed_doc_names": sorted(indexed_doc_names),
        "missing_on_disk": missing_on_disk,
        "not_indexed": not_indexed,
        "documents": [],
    }

    for dn in sorted(per_doc.keys()):
        e = per_doc[dn]
        cnt = int(e["count"])
        structured_pct = (int(e["structured"]) / cnt * 100.0) if cnt else 0.0
        avg_chars = (int(e["avg_chars_sum"]) / cnt) if cnt else 0.0

        flags = []
        if dn in pdf_risk:
            flags.append("SCANNED_OR_DRAWING_RISK")
        if dn in low_structured:
            flags.append("LOW_STRUCTURED_RATIO")

        json_payload["documents"].append(
            {
                "doc_name": dn,
                "doc_type": e.get("doc_type"),
                "pdf_kind": e.get("pdf_kind"),
                "chunks": cnt,
                "structured_pct": structured_pct,
                "avg_chars_per_chunk": avg_chars,
                "flags": flags,
                "samples": list(e["samples"]),
            }
        )

    OUT_JSON.write_text(json.dumps(json_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # Markdown output
    lines = []
    lines.append("# INGEST QUALITY REPORT\n\n")
    lines.append(f"- Generated at: **{json_payload['generated_at']}**\n")
    lines.append(f"- Chroma collection: `{json_payload['collection']}`\n")
    lines.append(f"- Total chunks: **{total}**\n")
    lines.append(f"- Total documents: **{len(per_doc)}**\n")

    if missing_on_disk:
        lines.append("\n## Warning: Indexed but not present on disk\n")
        for dn in missing_on_disk:
            lines.append(f"- {dn}\n")

    if not_indexed:
        lines.append("\n## Warning: Present on disk but not indexed\n")
        for dn in not_indexed:
            lines.append(f"- {dn}\n")

    lines.append("\n## Documents summary\n\n")
    lines.append("| doc_name | doc_type | pdf_kind | chunks | structured% | avg_chars | flags |\n")
    lines.append("|---|---:|---:|---:|---:|---:|---|\n")

    for d in json_payload["documents"]:
        lines.append(
            f"| {d['doc_name']} | {d.get('doc_type') or ''} | {d.get('pdf_kind') or ''} | "
            f"{d['chunks']} | {d['structured_pct']:.0f}% | {d['avg_chars_per_chunk']:.0f} | {', '.join(d['flags'])} |\n"
        )

    lines.append("\n## Samples (first 3 chunks per document)\n")
    for d in json_payload["documents"]:
        lines.append(f"\n### {d['doc_name']}\n\n")
        for s in d["samples"]:
            lines.append(f"- `{s}`\n")

    OUT_MD.write_text("".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD}")
    print(f"Wrote {OUT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

