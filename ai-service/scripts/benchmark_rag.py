"""
RAG Benchmark Script - Automated Testing for CEW AI Service
============================================================
Tests the RAG system against predefined "golden" test cases.
Sends queries to the API and validates responses contain expected keywords.

Usage:
    python scripts/benchmark_rag.py

Requirements:
    - ai-service backend must be running on http://localhost:8000
    - Run: uvicorn app.main:app --reload --port 8000
"""

import requests
import re
import sys
import os
from dataclasses import dataclass
from typing import Optional
import time

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# =============================================================================
# CONFIGURATION
# =============================================================================

API_BASE_URL = "http://localhost:8000"
API_ENDPOINT = f"{API_BASE_URL}/api/query"
TIMEOUT_SECONDS = 30

# =============================================================================
# TEST CASES - "GOLDEN" DATASET
# =============================================================================

@dataclass
class TestCase:
    """Represents a single test case with question, expected keywords, and mode."""
    id: str
    question: str
    expected_keywords: list[str]  # At least one must be present (OR logic)
    mode: str = "general"
    description: str = ""
    check_has_number: bool = False  # If True, just check if response contains any digit


# Define the golden test cases
TEST_CASES = [
    TestCase(
        id="TC-001",
        question="Panel markası nedir?",
        expected_keywords=["Jinko", "jinko", "JINKO"],
        mode="general",
        description="Should find panel brand from BOM Excel"
    ),
    TestCase(
        id="TC-002", 
        question="What is the panel brand?",
        expected_keywords=["Jinko", "jinko", "JINKO"],
        mode="general",
        description="English version of panel brand query"
    ),
    TestCase(
        id="TC-003",
        question="DC Kablo kesiti nedir?",
        expected_keywords=["mm", "4", "6", "10", "mm²", "mm2"],
        mode="general",
        description="Should find DC cable cross-section"
    ),
    TestCase(
        id="TC-004",
        question="What is the cable cross section?",
        expected_keywords=["mm", "4", "6", "10", "mm²", "mm2", "section"],
        mode="general",
        description="English cable cross-section query"
    ),
    TestCase(
        id="TC-005",
        question="Kablo tipi nedir?",
        expected_keywords=["cable", "Cable", "kablo", "Kablo", "Cu", "AL", "H1Z2Z2", "mm2", "mm²"],
        mode="general",
        description="Should find cable type specifications"
    ),
    TestCase(
        id="TC-006",
        question="Inverter tipi nedir?",
        expected_keywords=["inverter", "Inverter", "string", "String", "central", "Central", "Huawei", "SMA", "Sungrow"],
        mode="general",
        description="Should find inverter type from technical docs"
    ),
    TestCase(
        id="TC-007",
        question="Panel gücü kaç watt?",
        expected_keywords=["W", "watt", "Watt", "550", "540", "545", "580", "600", "670"],
        mode="general",
        description="Should find panel wattage"
    ),
    TestCase(
        id="TC-008",
        question="Proje adı nedir?",
        expected_keywords=["CEW", "solar", "Solar", "GES", "proje", "Project", "Haunton", "PV"],
        mode="general",
        description="Should find project name"
    ),
    TestCase(
        id="TC-009",
        question="panle mrakası nedir?",  # Intentional typos: panle → panel, mrakası → markası
        expected_keywords=["Jinko", "jinko", "JINKO"],
        mode="general",
        description="Should handle typos and still find panel brand"
    ),
    TestCase(
        id="TC-010",
        question="kabllo kesiti nedri?",  # Intentional typos: kabllo → kablo, nedri → nedir
        expected_keywords=["mm", "mm²", "mm2", "6", "kablo", "Kablo"],
        mode="general",
        description="Should handle Turkish typo and find cable cross-section"
    ),
]


# =============================================================================
# TEST RUNNER
# =============================================================================

class BenchmarkResult:
    """Holds results for a single test case."""
    def __init__(self, test_case: TestCase):
        self.test_case = test_case
        self.passed: bool = False
        self.response: Optional[str] = None
        self.error: Optional[str] = None
        self.duration_ms: float = 0
        self.matched_keyword: Optional[str] = None


def check_server_health() -> bool:
    """Check if the API server is running."""
    try:
        response = requests.get(f"{API_BASE_URL}/health", timeout=5)
        return response.status_code == 200
    except requests.exceptions.ConnectionError:
        return False
    except Exception:
        return False


def run_single_test(test_case: TestCase) -> BenchmarkResult:
    """Execute a single test case and return the result."""
    result = BenchmarkResult(test_case)
    
    try:
        start_time = time.time()
        
        # Send request to API
        payload = {
            "question": test_case.question,
            "mode": test_case.mode
        }
        
        response = requests.post(
            API_ENDPOINT,
            json=payload,
            timeout=TIMEOUT_SECONDS,
            headers={"Content-Type": "application/json"}
        )
        
        result.duration_ms = (time.time() - start_time) * 1000
        
        if response.status_code != 200:
            result.error = f"HTTP {response.status_code}: {response.text[:200]}"
            return result
        
        data = response.json()
        answer = data.get("answer", "")
        result.response = answer
        
        # Check if response contains expected content
        if test_case.check_has_number:
            # Just check for any digit
            if re.search(r'\d+', answer):
                result.passed = True
                result.matched_keyword = "[contains number]"
        else:
            # Check for expected keywords (OR logic - any match = pass)
            answer_lower = answer.lower()
            for keyword in test_case.expected_keywords:
                if keyword.lower() in answer_lower:
                    result.passed = True
                    result.matched_keyword = keyword
                    break
        
        # Check for failure indicators
        failure_phrases = [
            "information not found",
            "bilgi bulunamadı",
            "cannot find",
            "bulamadım",
            "not available",
            "mevcut değil"
        ]
        for phrase in failure_phrases:
            if phrase.lower() in answer.lower():
                result.passed = False
                result.error = f"Response indicates failure: '{phrase}'"
                break
                
    except requests.exceptions.Timeout:
        result.error = f"Request timed out after {TIMEOUT_SECONDS}s"
    except requests.exceptions.ConnectionError:
        result.error = "Connection refused - is the server running?"
    except Exception as e:
        result.error = f"Unexpected error: {str(e)}"
    
    return result


def print_result(result: BenchmarkResult, index: int):
    """Pretty print a single test result."""
    tc = result.test_case
    status = "✅ PASS" if result.passed else "❌ FAIL"
    
    print(f"\n{'='*70}")
    print(f"[{index}] {status} - {tc.id}: {tc.description}")
    print(f"{'='*70}")
    print(f"   Question: {tc.question}")
    print(f"   Mode: {tc.mode}")
    print(f"   Duration: {result.duration_ms:.0f}ms")
    
    if result.passed:
        print(f"   ✓ Matched: {result.matched_keyword}")
    
    if result.error:
        print(f"   ✗ Error: {result.error}")
    
    if result.response:
        # Truncate long responses
        response_preview = result.response[:200]
        if len(result.response) > 200:
            response_preview += "..."
        print(f"   Response: {response_preview}")
    
    if not result.passed and not result.error:
        print(f"   Expected one of: {tc.expected_keywords}")


def run_benchmark():
    """Run all test cases and print summary."""
    print("\n" + "=" * 70)
    print("🧪 CEW RAG BENCHMARK - Automated Test Suite")
    print("=" * 70)
    print(f"API Endpoint: {API_ENDPOINT}")
    print(f"Total Test Cases: {len(TEST_CASES)}")
    print("=" * 70)
    
    # Check server health
    print("\n⏳ Checking server health...")
    if not check_server_health():
        print("\n❌ ERROR: Cannot connect to API server!")
        print(f"   Make sure the server is running:")
        print(f"   cd ai-service")
        print(f"   .\\venv\\Scripts\\Activate")
        print(f"   uvicorn app.main:app --reload --port 8000")
        sys.exit(1)
    
    print("✅ Server is healthy!")
    
    # Run all tests
    results: list[BenchmarkResult] = []
    
    print("\n⏳ Running tests...")
    for i, test_case in enumerate(TEST_CASES, 1):
        print(f"   [{i}/{len(TEST_CASES)}] Testing: {test_case.id}...", end=" ", flush=True)
        result = run_single_test(test_case)
        results.append(result)
        print("✅" if result.passed else "❌")
    
    # Print detailed results
    print("\n\n" + "=" * 70)
    print("📊 DETAILED RESULTS")
    print("=" * 70)
    
    for i, result in enumerate(results, 1):
        print_result(result, i)
    
    # Print summary
    passed = sum(1 for r in results if r.passed)
    failed = len(results) - passed
    pass_rate = (passed / len(results)) * 100 if results else 0
    
    total_duration = sum(r.duration_ms for r in results)
    avg_duration = total_duration / len(results) if results else 0
    
    print("\n\n" + "=" * 70)
    print("📈 BENCHMARK SUMMARY")
    print("=" * 70)
    print(f"   Total Tests:     {len(results)}")
    print(f"   Passed:          {passed} ✅")
    print(f"   Failed:          {failed} ❌")
    print(f"   Pass Rate:       {pass_rate:.1f}%")
    print(f"   Total Duration:  {total_duration:.0f}ms")
    print(f"   Avg per Query:   {avg_duration:.0f}ms")
    print("=" * 70)
    
    # Final verdict
    if pass_rate == 100:
        print("\n🎉 ALL TESTS PASSED! RAG system is working correctly.")
    elif pass_rate >= 75:
        print("\n⚠️  MOSTLY PASSING - Some issues need attention.")
    elif pass_rate >= 50:
        print("\n⚠️  PARTIAL SUCCESS - Several tests failing.")
    else:
        print("\n❌ CRITICAL - Most tests failing. Check RAG configuration.")
    
    print("\n")
    
    # Return exit code based on results
    return 0 if pass_rate == 100 else 1


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    exit_code = run_benchmark()
    sys.exit(exit_code)
