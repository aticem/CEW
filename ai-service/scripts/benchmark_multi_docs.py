#!/usr/bin/env python3
"""
Multi-doc benchmark runner (hits /api/query).

Reads:
  - scripts/generated_multi_testcases.json
Writes:
  - ai-service/BENCHMARK_MULTI_DOC_REPORT.md
  - ai-service/scripts/benchmark_multi_docs_results.json

Usage:
  cd ai-service
  .\\venv\\Scripts\\Activate.ps1
  # ensure API server is running on :8000 (uvicorn app.main:app --reload --port 8000)
  python scripts/benchmark_multi_docs.py
"""

import argparse
import json
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).parent.parent
DEFAULT_IN = Path(__file__).parent / "generated_multi_testcases.json"
DEFAULT_OUT_MD = ROOT / "BENCHMARK_MULTI_DOC_REPORT.md"
DEFAULT_OUT_JSON = Path(__file__).parent / "benchmark_multi_docs_results.json"

sys.path.insert(0, str(ROOT))
from app.utils.language_detect import get_fallback_message  # noqa: E402


_CITATION_RE = re.compile(r"\[(Source|Kaynak):", flags=re.IGNORECASE)


def _has_citation(answer: str) -> bool:
    return bool(_CITATION_RE.search(answer or ""))


def _is_fallback(answer: str) -> bool:
    a = (answer or "").strip().lower()
    if not a:
        return True
    # Check both languages to be safe
    fb_tr = (get_fallback_message("tr") or "").strip().lower()
    fb_en = (get_fallback_message("en") or "").strip().lower()
    return (fb_tr and fb_tr in a) or (fb_en and fb_en in a)


def _doc_matches(expected_doc_name: str, answer: str, source: str | None) -> bool:
    exp = (expected_doc_name or "").strip()
    if not exp:
        return True
    blob = f"{source or ''}\n{answer or ''}"
    return exp.lower() in blob.lower()


def _keyword_hit(expected_keywords: list[str], answer: str) -> bool:
    a_raw = (answer or "")
    a = a_raw.lower()
    # Normalized answer for numeric tokens: "48,44" ~= "48.44"
    a_num = re.sub(r"\s+", "", a_raw).lower().replace(",", ".")

    toks = [str(t).strip() for t in (expected_keywords or []) if str(t).strip()]
    toks = [t for t in toks if len(t) >= 2]
    if not toks:
        return True
    for t in toks:
        tl = t.lower()
        if tl in a:
            return True
        # numeric equivalence tolerant match
        if re.fullmatch(r"\d+(?:[.,]\d+)?", t.strip()):
            tn = t.strip().replace(",", ".")
            if tn and tn in a_num:
                return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Run multi-doc benchmark via /api/query")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--in", dest="in_path", default=str(DEFAULT_IN))
    ap.add_argument("--out-md", default=str(DEFAULT_OUT_MD))
    ap.add_argument("--out-json", default=str(DEFAULT_OUT_JSON))
    ap.add_argument("--limit", type=int, default=0, help="0 = all tests")
    ap.add_argument("--sleep-ms", type=int, default=0)
    ap.add_argument("--timeout", type=float, default=60.0)
    args = ap.parse_args()

    in_path = Path(args.in_path)
    payload = json.loads(in_path.read_text(encoding="utf-8"))
    tests = payload.get("tests") or []
    if args.limit and int(args.limit) > 0:
        tests = tests[: int(args.limit)]

    url = args.base_url.rstrip("/") + "/api/query"
    timeout = httpx.Timeout(args.timeout)

    results: list[dict[str, Any]] = []
    fail_reasons = Counter()
    per_doc = defaultdict(lambda: {"pass": 0, "fail": 0})

    def post_with_retry(client: httpx.Client, payload: dict[str, Any]) -> httpx.Response:
        # Simple retry/backoff mainly for 429 TPM bursts.
        backoffs = [0.6, 1.2, 2.5]
        last_exc = None
        for attempt in range(len(backoffs) + 1):
            try:
                r = client.post(url, json=payload)
                if r.status_code == 429 and attempt < len(backoffs):
                    time.sleep(backoffs[attempt])
                    continue
                return r
            except httpx.RequestError as e:
                last_exc = e
                if attempt < len(backoffs):
                    time.sleep(backoffs[attempt])
                    continue
                raise
        if last_exc:
            raise last_exc
        raise RuntimeError("unreachable")

    with httpx.Client(timeout=timeout) as client:
        for t in tests:
            tid = t.get("id")
            q = str(t.get("question") or "").strip()
            expected_doc = str(t.get("expected_doc_name") or "").strip()
            expected_keywords = t.get("expected_keywords") or []

            # Force AUDIT mode for stronger validation
            q_audit = q + " kaynak göster"

            item = {
                "id": tid,
                "question": q,
                "expected_doc_name": expected_doc,
                "expected_keywords": expected_keywords,
                "ok": False,
                "fail_reason": None,
                "answer_preview": None,
                "source": None,
            }

            try:
                r = post_with_retry(client, {"question": q_audit, "mode": "general"})
                r.raise_for_status()
                data = r.json()
                answer = str(data.get("answer") or "")
                source = data.get("source")
                item["source"] = source
                item["answer_preview"] = (answer[:280] + ("…" if len(answer) > 280 else ""))

                # Checks
                if _is_fallback(answer):
                    item["fail_reason"] = "FALLBACK"
                elif not _has_citation(answer):
                    item["fail_reason"] = "NO_CITATION"
                elif not _doc_matches(expected_doc, answer, source):
                    item["fail_reason"] = "WRONG_DOC"
                elif not _keyword_hit(expected_keywords, answer):
                    item["fail_reason"] = "NO_EXPECTED_KEYWORD"
                else:
                    item["ok"] = True

            except httpx.RequestError as e:
                item["fail_reason"] = f"HTTP_ERROR: {type(e).__name__}"
            except httpx.HTTPStatusError as e:
                item["fail_reason"] = f"HTTP_{e.response.status_code}"
                try:
                    item["answer_preview"] = (e.response.text or "")[:280]
                except Exception:
                    pass
            except Exception as e:
                item["fail_reason"] = f"ERROR: {type(e).__name__}"

            results.append(item)
            if item["ok"]:
                per_doc[expected_doc]["pass"] += 1
            else:
                per_doc[expected_doc]["fail"] += 1
                fail_reasons[item["fail_reason"]] += 1

            if args.sleep_ms and int(args.sleep_ms) > 0:
                time.sleep(int(args.sleep_ms) / 1000.0)

    total = len(results)
    passed = sum(1 for r in results if r["ok"])
    pass_rate = (passed / total * 100.0) if total else 0.0

    out_json = Path(args.out_json)
    out_json.write_text(
        json.dumps(
            {
                "generated_at": datetime.now().isoformat(timespec="seconds"),
                "base_url": args.base_url,
                "input": str(in_path),
                "total": total,
                "passed": passed,
                "pass_rate": pass_rate,
                "fail_reasons": dict(fail_reasons),
                "per_doc": dict(per_doc),
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # Markdown report
    out_md = Path(args.out_md)
    lines: list[str] = []
    lines.append("# BENCHMARK MULTI DOC REPORT\n\n")
    lines.append(f"- Generated at: **{datetime.now().isoformat(timespec='seconds')}**\n")
    lines.append(f"- Base URL: `{args.base_url}`\n")
    lines.append(f"- Input: `{in_path.name}`\n")
    lines.append(f"- Total: **{total}**\n")
    lines.append(f"- Passed: **{passed}**\n")
    lines.append(f"- Pass rate: **{pass_rate:.1f}%**\n")

    lines.append("\n## Fail reasons\n\n")
    lines.append("| reason | count |\n|---|---:|\n")
    for reason, cnt in fail_reasons.most_common():
        lines.append(f"| {reason} | {cnt} |\n")

    lines.append("\n## Per-document pass rate\n\n")
    lines.append("| doc_name | passed | failed | pass% |\n|---|---:|---:|---:|\n")
    for doc_name, s in sorted(per_doc.items(), key=lambda kv: (kv[1]["fail"], kv[0]), reverse=True):
        p = int(s["pass"])
        f = int(s["fail"])
        denom = p + f
        pr = (p / denom * 100.0) if denom else 0.0
        lines.append(f"| {doc_name} | {p} | {f} | {pr:.1f}% |\n")

    lines.append("\n## Sample failures (first 10)\n\n")
    shown = 0
    for r in results:
        if r["ok"]:
            continue
        lines.append(f"### {r['id']} — {r['fail_reason']}\n\n")
        lines.append(f"- question: `{r['question']}`\n")
        lines.append(f"- expected_doc_name: `{r['expected_doc_name']}`\n")
        lines.append(f"- source: `{r.get('source')}`\n")
        lines.append(f"- answer_preview: `{r.get('answer_preview')}`\n\n")
        shown += 1
        if shown >= 10:
            break

    out_md.write_text("".join(lines), encoding="utf-8")
    print(f"Wrote {out_md}")
    print(f"Wrote {out_json}")
    print(f"Pass rate: {pass_rate:.1f}% ({passed}/{total})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

