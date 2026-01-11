#!/usr/bin/env python3
"""
Golden test generator for a single document already ingested into ChromaDB.

Goal:
- Build a high-signal benchmark set that tests "recall" (not missing facts)
  while still enforcing CEW guardrails (citation + no hallucination).

How it works:
- Reads ChromaDB documents + metadata
- Filters to a specific doc_name (default: Technical Description_Rev01.docx)
- Extracts candidate key/value facts from structured rows (DATA: Key: Value, ...)
- Emits a JSON file consumable by scripts/benchmark_td_rev01.py

Usage:
  cd ai-service
  .\venv\Scripts\Activate.ps1
  python scripts/build_golden_from_chroma.py --doc "Technical Description_Rev01.docx"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.chroma_service import get_collection  # noqa: E402


OUT_PATH = Path(__file__).parent / "generated_td_rev01_testcases.json"


def _iter_collection_docs(collection, batch_size: int = 1000):
    """Yield (doc_text, metadata) for all docs in the collection."""
    total = int(collection.count() or 0)
    offset = 0
    while offset < total:
        results = collection.get(
            limit=min(batch_size, total - offset),
            offset=offset,
            include=["documents", "metadatas"],
        )
        docs = results.get("documents") or []
        metas = results.get("metadatas") or []
        for doc_text, meta in zip(docs, metas):
            yield doc_text or "", meta or {}
        offset += batch_size


def _clean_key(k: str) -> str:
    k = re.sub(r"\s+", " ", (k or "").strip())
    k = k.strip("•-–—:;|")
    return k


def _clean_val(v: str) -> str:
    v = re.sub(r"\s+", " ", (v or "").strip())
    # Some structured rows in this dataset include double-colon formatting (e.g. "Project:: X"),
    # which our naive split can turn into values starting with ":".
    v = v.lstrip(":").strip()
    return v


def _extract_kv_pairs_from_structured_row(text: str) -> list[tuple[str, str]]:
    """
    Extract candidate key/value pairs from structured ingestion format:
      ... | DATA: Key1: Value1, Key2: Value2, ...
    """
    if not text or "DATA:" not in text:
        return []
    _, after = text.split("DATA:", 1)
    after = after.strip()
    if not after:
        return []

    parts = [p.strip() for p in after.split(",")]
    kvs: list[tuple[str, str]] = []
    for p in parts:
        if ":" not in p:
            continue
        k, v = p.split(":", 1)
        k = _clean_key(k)
        v = _clean_val(v)
        if not k or not v:
            continue
        kvs.append((k, v))
    return kvs


def _normalize_repeated_keys(kvs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """
    Many tables in this dataset are encoded as alternating label/value pairs with the same key repeated:
      "DATA: SUBSTATION 1: Modules / String, SUBSTATION 1: 27 Modules"
      -> (SUBSTATION 1 Modules / String) = (27 Modules)

    This normalization turns consecutive repeated-key sequences into more specific key/value pairs.
    """
    if not kvs:
        return []

    out: list[tuple[str, str]] = []
    i = 0
    while i < len(kvs):
        k, v = kvs[i]
        # Collect a run of the same key
        j = i
        run_vals: list[str] = []
        while j < len(kvs) and kvs[j][0] == k:
            run_vals.append(kvs[j][1])
            j += 1

        if len(run_vals) >= 2:
            # Pair as (label, value) sequentially
            for p in range(0, len(run_vals) - 1, 2):
                label = _clean_key(run_vals[p])
                value = _clean_val(run_vals[p + 1])
                merged_key = _clean_key(f"{k} {label}")
                if merged_key and value:
                    out.append((merged_key, value))
        else:
            out.append((_clean_key(k), _clean_val(v)))

        i = j

    return out


def _value_tokens(v: str) -> list[str]:
    """
    Build expected keyword tokens from a value string.
    We keep it conservative to reduce false negatives.
    """
    v = (v or "").strip()
    if not v:
        return []

    tokens: list[str] = []

    # Primary numeric token (first number-like substring)
    m = re.search(r"\d+(?:[.,]\d+)?", v)
    if m:
        tokens.append(m.group(0))

    # Common units / spec markers
    unit_hits = re.findall(r"(mm²|mm2|mm|m|kW|MW|W|WP|V|A|Hz|%)", v, flags=re.IGNORECASE)
    for uh in unit_hits[:2]:
        tokens.append(uh)

    # Cable/spec identifiers like H1Z2Z2-K, SG350HX, etc.
    id_hits = re.findall(r"\b[A-Z0-9][A-Z0-9\-_/]{3,}\b", v)
    for ih in id_hits[:2]:
        tokens.append(ih)

    # Deduplicate while preserving order
    seen = set()
    out = []
    for t in tokens:
        tl = t.lower()
        if tl in seen:
            continue
        seen.add(tl)
        out.append(t)
    return out


def _build_testcases(doc_name: str, max_tests: int | None = 80) -> list[dict[str, Any]]:
    collection = get_collection()

    candidates: list[dict[str, Any]] = []

    for doc_text, meta in _iter_collection_docs(collection):
        if str(meta.get("doc_name") or "") != doc_name:
            continue

        # Prefer structured rows: they produce stable key/value facts.
        raw_kvs = _extract_kv_pairs_from_structured_row(doc_text)
        for k, v in _normalize_repeated_keys(raw_kvs):
            # Skip low-signal keys (e.g., "5ºC") that contain no meaningful letters.
            if not re.search(r"[A-Za-zğüşöçıİĞÜŞÖÇ]{3,}", k or ""):
                continue

            # Only keep high-signal facts (must contain a number or a strong identifier)
            if not (re.search(r"\d", v) or re.search(r"\b[A-Z0-9][A-Z0-9\-_/]{3,}\b", v)):
                continue

            # Skip known low-signal / misleading fields for this dataset (prevents false benchmark failures)
            # Example: "Project" rows that are actually revision/date/document-number artifacts.
            if _clean_key(k).lower() == "project":
                # Require at least one real word token (3+ letters) to treat it as a project name.
                if not re.search(r"[A-Za-z]{3,}", v):
                    continue

            candidates.append(
                {
                    "key": k,
                    "value": v,
                    "meta": meta,
                }
            )

    # De-duplicate by (key,value)
    uniq = {}
    for c in candidates:
        kk = (c["key"].lower(), c["value"].lower())
        uniq.setdefault(kk, c)
    candidates = list(uniq.values())

    # Sort: value contains digits first, then shorter keys first (often more \"field-like\")
    def sort_key(c):
        v = c["value"]
        return (0 if re.search(r"\d", v) else 1, len(c["key"]), len(v))

    candidates.sort(key=sort_key)

    if max_tests is not None:
        candidates = candidates[: max(0, int(max_tests))]

    testcases: list[dict[str, Any]] = []
    for i, c in enumerate(candidates, start=1):
        meta = c["meta"] or {}
        key = c["key"]
        val = c["value"]
        tokens = _value_tokens(val)

        location_parts = []
        if meta.get("page") is not None:
            location_parts.append(f"Page {meta.get('page')}")
        if meta.get("sheet") is not None:
            location_parts.append(f"Sheet: {meta.get('sheet')}")
        if meta.get("section") is not None:
            location_parts.append(f"Section: {meta.get('section')}")
        location = ", ".join([p for p in location_parts if p])

        # Very simple TR/EN question generation; humans can refine later.
        q_en = f"What is the value of '{key}'?"
        q_tr = f"'{key}' değeri nedir?"

        testcases.append(
            {
                "id": f"TD-REV01-{i:03d}",
                "mode": "general",
                "question_en": q_en,
                "question_tr": q_tr,
                "expected_keywords": tokens if tokens else [val],
                "doc_name": doc_name,
                "location_hint": location,
                "key": key,
                "value": val,
            }
        )

    return testcases


def main():
    parser = argparse.ArgumentParser(description="Generate golden benchmark tests from ChromaDB for a single doc")
    parser.add_argument("--doc", default="Technical Description_Rev01.docx", help="doc_name metadata to filter on")
    parser.add_argument("--max-tests", type=int, default=80, help="max number of tests to emit")
    parser.add_argument("--out", default=str(OUT_PATH), help="output json path")
    args = parser.parse_args()

    tests = _build_testcases(doc_name=args.doc, max_tests=args.max_tests)

    payload = {
        "doc_name": args.doc,
        "count": len(tests),
        "tests": tests,
    }

    out_path = Path(args.out)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(tests)} testcases to: {out_path}")

    if len(tests) == 0:
        print("WARNING: No testcases generated. Likely causes:")
        print("- ChromaDB is empty (run scripts/ingest.py)")
        print("- Metadata doc_name mismatch (check scripts/inspect_db.py output)")


if __name__ == "__main__":
    main()

