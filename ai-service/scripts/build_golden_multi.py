#!/usr/bin/env python3
"""
Generate multi-document golden testcases from ChromaDB.

Goal: produce stable, non-ambiguous questions that work in multi-doc RAG.

Output:
- ai-service/scripts/generated_multi_testcases.json

Usage:
  cd ai-service
  .\\venv\\Scripts\\Activate.ps1
  python scripts/build_golden_multi.py --max-tests-per-doc 60
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

_BAD_KEYS = {
    "description",
    "item",
    "items",
    "column",
    "note",
    "notes",
    "remark",
    "remarks",
    "unnamed",
}


def _clean_key(k: str) -> str:
    k = re.sub(r"\s+", " ", (k or "").strip())
    return k.strip("•-–—:;|,")


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
    # Robust parsing: values can contain commas (e.g. "1,419"), so we only split on commas
    # that look like they introduce a new "Key:" segment.
    out: list[tuple[str, str]] = []
    for m in re.finditer(
        r"(?P<key>[^:]{1,120}):\s*(?P<val>.*?)(?=(?:,\s*[^:]{1,120}:\s*)|$)",
        after,
        flags=re.DOTALL,
    ):
        k = _clean_key(m.group("key"))
        v = _clean_val(m.group("val"))
        if k and v:
            out.append((k, v))
    return out


def _extract_numeric_facts_from_content(text: str) -> list[dict[str, str]]:
    """
    Extract lightweight numeric facts from CONTENT blocks (PDF narrative).
    Returns items with:
      - key_hint: short context phrase
      - value: matched number+unit string
    """
    if not text or "CONTENT:" not in text:
        return []
    _, after = text.split("CONTENT:", 1)
    after = re.sub(r"\s+", " ", after).strip()
    if not after:
        return []

    facts: list[dict[str, str]] = []
    # e.g. "2m", "4 weeks", "0.6/1 kV", "40ºC", "40°C", "1,419"
    for m in re.finditer(
        r"(?P<num>\d+(?:[.,]\d+)?)\s*(?P<unit>mm²|mm2|mm|m|weeks?|days?|years?|%|kV|kW|MW|V|A|Hz|°C|ºC)",
        after,
        flags=re.IGNORECASE,
    ):
        start = max(0, m.start() - 60)
        end = min(len(after), m.end() + 60)
        window = after[start:end].strip()
        window = re.sub(r"[^0-9A-Za-zğüşöçıİĞÜŞÖÇ%°º/.\- ]+", " ", window)
        window = re.sub(r"\s+", " ", window).strip()

        value = f"{m.group('num')}{m.group('unit')}".replace(" ", "")
        facts.append({"key_hint": window[:90], "value": value})

        if len(facts) >= 5:  # keep per-chunk small
            break
    return facts


def _value_tokens(v: str) -> list[str]:
    v = (v or "").strip()
    if not v:
        return []
    tokens: list[str] = []
    m = re.search(r"\d+(?:[.,]\d+)?", v)
    if m:
        tokens.append(m.group(0))
    # Only treat these as units when attached to a number, otherwise we get noisy matches (e.g. "m" in words).
    unit_hits = re.findall(
        r"\d+(?:[.,]\d+)?\s*(mm²|mm2|mm|m|kW|MW|W|WP|kV|kVA|V|A|Hz|%)\b",
        v,
        flags=re.IGNORECASE,
    )
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


def _infer_doc_type(doc_name: str, meta_doc_type: str | None) -> str:
    if meta_doc_type:
        return str(meta_doc_type)
    n = (doc_name or "").lower()
    if n.endswith(".pdf"):
        return "pdf"
    if n.endswith(".docx") or n.endswith(".doc"):
        return "word"
    if n.endswith(".xlsx") or n.endswith(".xls"):
        return "excel"
    return "unknown"


def _is_low_signal_key(k: str) -> bool:
    kl = (k or "").strip().lower()
    if not re.search(r"[A-Za-zğüşöçıİĞÜŞÖÇ]{3,}", kl):
        return True
    # very short ALLCAPS keys (e.g. "YEAR") are usually too generic
    if re.fullmatch(r"[A-Z]{3,6}", (k or "").strip()):
        return True
    if any(bad in kl for bad in _BAD_KEYS):
        return True
    if re.fullmatch(r"column_?\d+", kl):
        return True
    if kl.startswith("column_"):
        return True
    if kl.startswith("unnamed"):
        return True
    return False


def _shorten_for_question(s: str, max_len: int = 60) -> str:
    s = re.sub(r"\s+", " ", (s or "").strip())
    if not s:
        return ""
    # Prefer first clause/sentence
    for sep in ["|", ";", "•", " - ", " – ", " — ", ". "]:
        if sep in s:
            s = s.split(sep, 1)[0].strip()
    if len(s) > max_len:
        s = s[: max_len - 1].rstrip() + "…"
    return s


def _make_question_tr_content_numeric(key_hint: str, value: str) -> str | None:
    v = (value or "").strip()
    m = re.match(r"(?P<num>\d+(?:[.,]\d+)?)(?P<unit>mm²|mm2|mm|m|weeks?|days?|years?|%|kV|kW|MW|V|A|Hz|°C|ºC)\b", v, flags=re.IGNORECASE)
    if not m:
        return None
    unit = m.group("unit")
    # Remove the matched value from context and shorten
    ctx = (key_hint or "")
    ctx = re.sub(re.escape(v), " ", ctx, flags=re.IGNORECASE)
    ctx = re.sub(r"\s+", " ", ctx).strip()
    ctx = _shorten_for_question(ctx, max_len=70)
    if len(ctx) < 12:
        return None
    return f"Dokümana göre {ctx} kaç {unit}?"


def _make_question_tr(key: str, value: str, doc_type: str, meta: dict[str, Any] | None) -> str | None:
    key = _shorten_for_question(_clean_key(key), max_len=70)
    value = _clean_val(value)
    if not key or not value:
        return None
    if _is_low_signal_key(key):
        return None

    # If the value has a leading label before a comma, use it to disambiguate.
    label = None
    if "," in value:
        head = value.split(",", 1)[0].strip()
        if 3 <= len(head) <= 60 and re.search(r"[A-Za-zğüşöçıİĞÜŞÖÇ]{3,}", head):
            label = head

    if doc_type == "excel":
        sheet = _shorten_for_question(str((meta or {}).get("sheet") or ""), max_len=35)
        if label:
            return f"{label} için {key} değeri nedir?"
        if sheet and isinstance(sheet, str) and sheet.strip():
            return f"{sheet} sayfasında {key} değeri nedir?"
        return f"{key} değeri nedir?"

    if label:
        return f"{label} için {key} değeri nedir?"
    return f"{key} değeri nedir?"


def _qualifier_from_value(value: str, key: str) -> str | None:
    """
    Build a short qualifier to disambiguate repeated keys without leaking the answer.
    Prefer alphabetic tokens (no digits/units).
    """
    v = (value or "").strip()
    k = (key or "").lower()
    if not v:
        return None
    # Date-like values -> "tarih"
    if re.search(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b", v):
        return "tarih"
    if re.search(r"\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b", v):
        return "tarih"

    # Grab a couple of alphabetic words
    words = re.findall(r"\b[^\W\d_]{4,}\b", v, flags=re.UNICODE)
    out = []
    for w in words:
        wl = w.lower()
        if wl in k:
            continue
        if wl in ("the", "and", "with", "from", "into", "this", "that", "for", "between"):
            continue
        if wl in ("ve", "ile", "için", "olarak", "kadar", "arasında"):
            continue
        out.append(w)
        if len(out) >= 2:
            break
    if out:
        return " ".join(out)
    return None

def main() -> int:
    ap = argparse.ArgumentParser(description="Generate golden testcases across all docs in ChromaDB")
    ap.add_argument("--max-tests-per-doc", type=int, default=60)
    ap.add_argument("--max-total", type=int, default=120)
    ap.add_argument(
        "--include-content-numeric",
        action="store_true",
        help="Also generate numeric questions from PDF CONTENT blocks (lower precision; off by default).",
    )
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
    # Track duplicates across docs for DATA candidates to avoid multi-doc ambiguity.
    kv_to_docs: dict[tuple[str, str], set[str]] = defaultdict(set)

    for text, meta in zip(docs, metas):
        meta = meta or {}
        doc_name = str(meta.get("doc_name") or "UNKNOWN")
        doc_type = _infer_doc_type(doc_name, meta.get("doc_type"))
        pdf_kind = meta.get("pdf_kind")

        # Prefer structured DATA rows (stable)
        for k, v in _extract_kv_pairs(text or ""):
            k = _clean_key(k)
            v = _clean_val(v)

            # Filter very low-signal keys
            if _is_low_signal_key(k):
                continue
            # Prefer values with strong anchors (numbers or stable IDs) for reliable evaluation.
            has_number = bool(re.search(r"\d", v))
            has_id = bool(re.search(r"\b[A-Z0-9][A-Z0-9\\-_/]{3,}\b", v))
            if not (has_number or has_id):
                continue
            # If it's "ID-only" (no numbers), require it to look like a real code (contains digits or separators)
            # to avoid generic uppercase labels like "MAINTANCE" becoming brittle tests.
            if (not has_number) and has_id:
                if not re.search(r"[\d\-_/]", v):
                    continue

            kv_to_docs[(k.lower(), v.lower())].add(doc_name)
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

        # Optional: mine numeric facts from CONTENT (mainly PDFs) to reach target test count.
        # Off by default because it creates many low-signal / ambiguous questions.
        if args.include_content_numeric:
            for f in _extract_numeric_facts_from_content(text or ""):
                key_hint = _clean_key(f.get("key_hint", ""))
                val = _clean_val(f.get("value", ""))
                if not key_hint or not val:
                    continue
                if len(key_hint) < 12:
                    continue
                by_doc[doc_name].append(
                    {
                        "doc_name": doc_name,
                        "doc_type": doc_type,
                        "pdf_kind": pdf_kind,
                        "key": key_hint,
                        "value": val,
                        "meta": {
                            "page": meta.get("page"),
                            "sheet": meta.get("sheet"),
                            "section": meta.get("section"),
                            "table_num": meta.get("table_num"),
                        },
                        "kind": "content_numeric",
                    }
                )

    tests_by_doc: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for doc_name, rows in sorted(by_doc.items(), key=lambda kv: len(kv[1]), reverse=True):
        # De-dup by (key,value)
        uniq = {}
        for r in rows:
            kk = (r["key"].lower(), r["value"].lower())
            uniq.setdefault(kk, r)
        rows = list(uniq.values())

        # Multi-doc ambiguity filter for DATA candidates: drop if the exact (key,value) appears in multiple docs.
        filtered = []
        for r in rows:
            if r.get("kind") == "content_numeric":
                filtered.append(r)
                continue
            if len(kv_to_docs.get((r["key"].lower(), r["value"].lower()), set())) > 1:
                continue
            filtered.append(r)
        rows = filtered

        # Prioritize numeric values (better for evaluation)
        rows.sort(key=lambda r: (0 if re.search(r"\d", r["value"]) else 1, len(r["key"]), len(r["value"])))
        rows = rows[: max(0, int(args.max_tests_per_doc))]

        seen_questions = set()
        test_id_local = 1
        for r in rows:
            key = r["key"]
            val = r["value"]
            doc_type = r.get("doc_type") or "unknown"

            if r.get("kind") == "content_numeric":
                q_tr = _make_question_tr_content_numeric(key, val)
            else:
                q_tr = _make_question_tr(key, val, doc_type, r.get("meta") or {})
            if not q_tr:
                continue
            q_norm = re.sub(r"\s+", " ", q_tr.strip().lower())
            if q_norm in seen_questions:
                qual = _qualifier_from_value(val, key)
                if qual:
                    q_tr2 = q_tr.replace(key, f"{key} ({qual})", 1) if key in q_tr else f"{q_tr} ({qual})"
                    q_norm2 = re.sub(r"\s+", " ", q_tr2.strip().lower())
                    if q_norm2 not in seen_questions:
                        q_tr = q_tr2
                        q_norm = q_norm2
            if q_norm in seen_questions:
                continue
            seen_questions.add(q_norm)

            tests_by_doc[doc_name].append(
                {
                    "id": f"{doc_name}::{test_id_local:05d}",
                    "mode": "general",
                    "question": q_tr,
                    "expected_keywords": _value_tokens(val) or [val],
                    "expected_doc_name": doc_name,
                    "doc_type": doc_type,
                    "pdf_kind": r.get("pdf_kind"),
                    "key": key,
                    "value": val,
                }
            )
            test_id_local += 1

    # Round-robin selection across documents to avoid one doc dominating the suite.
    max_total = max(1, int(args.max_total))
    doc_order = sorted(tests_by_doc.keys())
    final_tests: list[dict[str, Any]] = []
    i = 0
    while len(final_tests) < max_total:
        added_any = False
        for dn in doc_order:
            lst = tests_by_doc.get(dn) or []
            if i < len(lst) and len(final_tests) < max_total:
                final_tests.append(lst[i])
                added_any = True
        if not added_any:
            break
        i += 1

    # Re-number ids sequentially for stable reporting.
    for idx, t in enumerate(final_tests, start=1):
        t["id"] = f"MULTI-{idx:05d}"

    payload = {
        "total_chunks": total,
        "documents": list(sorted(by_doc.keys())),
        "tests": final_tests,
    }
    out_path = Path(args.out)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(final_tests)} testcases to: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

