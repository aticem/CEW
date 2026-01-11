#!/usr/bin/env python3
"""
Single-document benchmark runner (Technical Description_Rev01.docx).

This is a recall-focused benchmark:
- FAIL if answer contains fallback phrasing (\"cannot find\" / \"bulamıyorum\" etc.)
- FAIL if answer does not include citation brackets ([Source: ...] or [Kaynak: ...])
- PASS if answer contains at least one expected keyword token

Input testcases are generated via:
  python scripts/build_golden_from_chroma.py --doc "Technical Description_Rev01.docx"

Usage:
  python scripts/benchmark_td_rev01.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


DEFAULT_API_BASE_URL = "http://localhost:8000"
DEFAULT_JSON_PATH = Path(__file__).parent / "generated_td_rev01_testcases.json"


FALLBACK_PHRASES = [
    "information not found",
    "bilgi bulunamadı",
    "cannot find",
    "bulamadım",
    "not available",
    "mevcut değil",
    "bu bilgiyi mevcut",  # TR fallback prefix used in app.utils.language_detect
]


@dataclass
class TestCase:
    id: str
    question: str
    expected_keywords: list[str]
    mode: str = "general"
    description: str = ""
    require_citation: bool = True
    require_docname_in_source: Optional[str] = None


class BenchmarkResult:
    def __init__(self, test_case: TestCase):
        self.test_case = test_case
        self.passed: bool = False
        self.response: Optional[str] = None
        self.source: Optional[str] = None
        self.error: Optional[str] = None
        self.duration_ms: float = 0
        self.matched_keyword: Optional[str] = None


def load_testcases(json_path: Path, limit: Optional[int] = None) -> list[TestCase]:
    if not json_path.exists():
        # Minimal fallback set (manual) if generator hasn't been run yet.
        return [
            TestCase(
                id="TD-REV01-001",
                question="Minimum trench depth nedir?",
                expected_keywords=["800", "mm"],
                description="Manual fallback test (run build_golden_from_chroma.py for full suite)",
            )
        ]

    payload = json.loads(json_path.read_text(encoding="utf-8"))
    tests_raw = payload.get("tests") or []

    out: list[TestCase] = []
    for t in tests_raw:
        # Prefer Turkish question by default (repo has TR-specific typo logic)
        q = (t.get("question_tr") or "").strip() or (t.get("question_en") or "").strip()
        if not q:
            continue
        out.append(
            TestCase(
                id=str(t.get("id") or ""),
                question=q,
                expected_keywords=list(t.get("expected_keywords") or []),
                mode=str(t.get("mode") or "general"),
                description=f"{t.get('key', '')} @ {t.get('location_hint', '')}".strip(),
                require_citation=True,
                require_docname_in_source=str(t.get("doc_name") or None) if t.get("doc_name") else None,
            )
        )

    if limit is not None:
        out = out[: max(0, int(limit))]
    return out


def check_server_health(api_base_url: str) -> bool:
    try:
        response = requests.get(f"{api_base_url}/health", timeout=5)
        return response.status_code == 200
    except Exception:
        return False


def has_citation(answer: str) -> bool:
    return bool(re.search(r"\[(?:Source|Kaynak):", answer or "", flags=re.IGNORECASE))


def contains_fallback(answer: str) -> Optional[str]:
    a = (answer or "").lower()
    for phrase in FALLBACK_PHRASES:
        if phrase.lower() in a:
            return phrase
    return None


def run_single_test(api_endpoint: str, test_case: TestCase, timeout_s: int) -> BenchmarkResult:
    result = BenchmarkResult(test_case)
    try:
        start = time.time()
        payload = {"question": test_case.question, "mode": test_case.mode}
        r = requests.post(
            api_endpoint,
            json=payload,
            timeout=timeout_s,
            headers={"Content-Type": "application/json"},
        )
        result.duration_ms = (time.time() - start) * 1000

        if r.status_code != 200:
            result.error = f"HTTP {r.status_code}: {r.text[:200]}"
            return result

        data = r.json()
        answer = data.get("answer", "") or ""
        source = data.get("source")
        result.response = answer
        result.source = source

        fb = contains_fallback(answer)
        if fb:
            result.passed = False
            result.error = f"Fallback detected: '{fb}'"
            return result

        if test_case.require_citation and not has_citation(answer):
            result.passed = False
            result.error = "Missing citation bracket ([Source: ...] or [Kaynak: ...])"
            return result

        if test_case.require_docname_in_source and source:
            if test_case.require_docname_in_source not in str(source):
                result.passed = False
                result.error = f"Source doc mismatch (expected '{test_case.require_docname_in_source}')"
                return result

        # Keyword match (OR)
        answer_lower = answer.lower()
        for kw in test_case.expected_keywords:
            if str(kw).lower() in answer_lower:
                result.passed = True
                result.matched_keyword = kw
                return result

        result.passed = False
        result.error = f"No expected keywords found (first 10): {test_case.expected_keywords[:10]}"
        return result

    except requests.exceptions.Timeout:
        result.error = f"Request timed out after {timeout_s}s"
        return result
    except requests.exceptions.ConnectionError:
        result.error = "Connection refused - is the server running?"
        return result
    except Exception as e:
        result.error = f"Unexpected error: {e}"
        return result


def main():
    parser = argparse.ArgumentParser(description="Benchmark RAG recall for a single doc (TD Rev01)")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE_URL)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--tests-json", default=str(DEFAULT_JSON_PATH))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--audit",
        action="store_true",
        help="Append an audit trigger to each question so the model includes excerpts (stable for benchmarking).",
    )
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    api_endpoint = f"{api_base}/api/query"

    print("=" * 70)
    print("CEW TD Rev01 BENCHMARK")
    print("=" * 70)
    print(f"API: {api_endpoint}")
    print(f"Tests JSON: {args.tests_json}")

    if not check_server_health(api_base):
        print("\nERROR: API server not responding.")
        print("Run:")
        print("  cd ai-service")
        print("  .\\venv\\Scripts\\Activate.ps1")
        print("  uvicorn app.main:app --reload --port 8000")
        sys.exit(1)

    testcases = load_testcases(Path(args.tests_json), limit=args.limit)
    print(f"Total tests: {len(testcases)}")

    results: list[BenchmarkResult] = []
    for i, tc in enumerate(testcases, start=1):
        print(f"[{i}/{len(testcases)}] {tc.id}...", end=" ", flush=True)
        if args.audit:
            # Trigger AUDIT mode per system_general.txt (shows excerpts + answer).
            tc = TestCase(
                id=tc.id,
                question=f"{tc.question}\n\nKaynak göster.",
                expected_keywords=tc.expected_keywords,
                mode=tc.mode,
                description=tc.description,
                require_citation=tc.require_citation,
                require_docname_in_source=tc.require_docname_in_source,
            )
        r = run_single_test(api_endpoint, tc, timeout_s=int(args.timeout))
        results.append(r)
        print("PASS" if r.passed else "FAIL")

    passed = sum(1 for r in results if r.passed)
    total = len(results)
    pct = (passed / total * 100) if total else 0.0
    avg_ms = (sum(r.duration_ms for r in results) / total) if total else 0.0

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"Passed: {passed}/{total} ({pct:.1f}%)")
    print(f"Avg latency: {avg_ms:.0f}ms")

    failures = [r for r in results if not r.passed]
    if failures:
        print("\n" + "=" * 70)
        print("FAILURES (first 10)")
        print("=" * 70)
        for f in failures[:10]:
            tc = f.test_case
            preview = (f.response or "")[:260].replace("\n", " ")
            print(f"- {tc.id}: {f.error}")
            print(f"  Q: {tc.question}")
            if preview:
                print(f"  A: {preview}{'...' if len((f.response or '')) > 260 else ''}")
    sys.exit(0 if pct == 100 else 1)


if __name__ == "__main__":
    main()

