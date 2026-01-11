#!/usr/bin/env python3
"""
Generate multi-document golden testcases from ChromaDB.

Goal: produce stable, non-ambiguous questions that work in multi-doc RAG.

Output:
- ai-service/scripts/generated_multi_testcases.json

Usage:
  cd ai-service
  .\\venv\\Scripts\\Activate.ps1
  python scripts/build_golden_multi.py --max-tests-per-doc 30
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.chroma_service import get_collection  # noqa: E402


OUT_PATH = Path(__file__).parent / "generated_multi_testcases.json"


def _clean_key(k: str) -> str:
    k = re.sub(r"\s+", " ", (k or "").strip())
    return k.strip("•-–—:;|")


def _clean_val(v: str) -> str:
    v = re.sub(r"\s+", " ", (v or "").strip())
    return v.lstrip(":").strip()


def _extract_kv_pairs(text: str) -> list[tuple[str, str]]:
    if not text or "DATA:" not in text:
        return []
    _, after = text.split("DATA:", 1)
    after = after.strip()
    if not after:
        return []
    parts = [p.strip() for p in after.split(",")]
    out = []
    for p in parts:
        if ":" not in p:
            continue
        k, v = p.split(":", 1)
        k = _clean_key(k)
        v = _clean_val(v)
        if k and v:
            out.append((k, v))
    return out


def _value_tokens(v: str) -> list[str]:
    v = (v or "").strip()
    if not v:
        return []
    tokens: list[str] = []
    m = re.search(r"\d+(?:[.,]\d+)?", v)
    if m:
        tokens.append(m.group(0))
    unit_hits = re.findall(r"(mm²|mm2|mm|m|kW|MW|W|WP|V|A|Hz|kV|kVA|%)", v, flags=re.IGNORECASE)
    for uh in unit_hits[:2]:
        tokens.append(uh)
    id_hits = re.findall(r"\b[A-Z0-9][A-Z0-9\-_/]{3,}\b", v)
    for ih in id_hits[:2]:
        tokens.append(ih)
    # Dedup
    seen = set()
    out = []
    for t in tokens:
        tl = t.lower()
        if tl in seen:
            continue
        seen.add(tl)
        out.append(t)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate golden testcases across all docs in ChromaDB")
    ap.add_argument("--max-tests-per-doc", type=int, default=30)
    ap.add_argument("--out", default=str(OUT_PATH))
    args = ap.parse_args()

    col = get_collection()
    total = int(col.count() or 0)
    if total == 0:
        print("Chroma collection empty. Run scripts/ingest.py first.")
        return 1

    res = col.get(limit=max(2000, total), include=["documents", "metadatas"])
    docs = res.get("documents") or []
    metas = res.get("metadatas") or []

    by_doc: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for text, meta in zip(docs, metas):
        meta = meta or {}
        doc_name = str(meta.get("doc_name") or "UNKNOWN")
        doc_type = str(meta.get("doc_type") or "unknown")
        pdf_kind = meta.get("pdf_kind")

        # Only use structured DATA rows for now (more stable)
        for k, v in _extract_kv_pairs(text or ""):
            k = _clean_key(k)
            v = _clean_val(v)

            # Filter very low-signal keys
            if not re.search(r"[A-Za-zğüşöçıİĞÜŞÖÇ]{3,}", k):
                continue
            if not (re.search(r"\d", v) or re.search(r"\b[A-Z0-9][A-Z0-9\\-_/]{3,}\b", v)):
                continue

            by_doc[doc_name].append(
                {
                    "doc_name": doc_name,
                    "doc_type": doc_type,
                    "pdf_kind": pdf_kind,
                    "key": k,
                    "value": v,
                    "meta": {
                        "page": meta.get("page"),
                        "sheet": meta.get("sheet"),
                        "section": meta.get("section"),
                        "table_num": meta.get("table_num"),
                    },
                }
            )

    tests: list[dict[str, Any]] = []
    test_id = 1

    for doc_name, rows in sorted(by_doc.items(), key=lambda kv: len(kv[1]), reverse=True):
        # De-dup by (key,value)
        uniq = {}
        for r in rows:
            kk = (r["key"].lower(), r["value"].lower())
            uniq.setdefault(kk, r)
        rows = list(uniq.values())

        # Prioritize numeric values (better for evaluation)
        rows.sort(key=lambda r: (0 if re.search(r"\d", r["value"]) else 1, len(r["key"]), len(r["value"])))
        rows = rows[: max(0, int(args.max_tests_per_doc))]

        for r in rows:
            key = r["key"]
            val = r["value"]
            doc_type = r.get("doc_type") or "unknown"

            # Make question slightly less ambiguous in multi-doc by mentioning doc_name.
            if doc_type == "excel":
                sheet = (r.get("meta") or {}).get("sheet")
                q_tr = f"{doc_name} içinde{(' ' + str(sheet)) if sheet else ''} için '{key}' değeri nedir?"
            else:
                q_tr = f"{doc_name} içinde '{key}' değeri nedir?"

            tests.append(
                {
                    "id": f"MULTI-{test_id:05d}",
                    "mode": "general",
                    "question": q_tr,
                    "expected_keywords": _value_tokens(val) or [val],
                    "doc_name": doc_name,
                    "doc_type": doc_type,
                    "pdf_kind": r.get("pdf_kind"),
                    "key": key,
                    "value": val,
                }
            )
            test_id += 1

    payload = {
        "total_chunks": total,
        "documents": list(sorted(by_doc.keys())),
        "tests": tests,
    }
    out_path = Path(args.out)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(tests)} testcases to: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

