"""
Smart Logic Benchmark - Tests AI Reasoning Capabilities
=========================================================
Tests typo handling, ambiguity resolution, and citation enforcement.
This is NOT a retrieval test - it's an INTELLIGENCE test.

Usage:
    python scripts/benchmark_smart_logic.py

Requirements:
    - ai-service backend must be running on http://localhost:8000
"""

import requests
import re
import sys
import time

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# =============================================================================
# CONFIGURATION
# =============================================================================

API_BASE_URL = "http://localhost:8000"
API_ENDPOINT = f"{API_BASE_URL}/api/query"
TIMEOUT_SECONDS = 60  # Higher timeout for gpt-4o

# =============================================================================
# SMART LOGIC TEST CASES
# =============================================================================

class SmartTestCase:
    """A test case for reasoning/logic capabilities."""
    
    def __init__(
        self,
        id: str,
        query: str,
        description: str,
        success_check: callable,
        failure_keywords: list = None
    ):
        self.id = id
        self.query = query
        self.description = description
        self.success_check = success_check
        self.failure_keywords = failure_keywords or []


def check_has_number(response: str) -> tuple[bool, str]:
    """Check if response contains any number."""
    if re.search(r'\d+', response):
        return True, "Contains numeric data"
    return False, "No numbers found in response"


def check_no_confusion(response: str) -> tuple[bool, str]:
    """Check that AI didn't express confusion about the typos."""
    confusion_phrases = [
        "anlamadım", "i don't understand", "could you clarify",
        "ne demek istiyorsunuz", "what do you mean", "unclear",
        "belirsiz", "tam olarak", "specifically", "hangi",
        "which one", "which type"
    ]
    response_lower = response.lower()
    for phrase in confusion_phrases:
        if phrase in response_lower:
            return False, f"AI expressed confusion: '{phrase}'"
    return True, "No confusion expressed"


def check_breakdown_given(response: str) -> tuple[bool, str]:
    """Check if response contains a breakdown with DC AND AC cable info."""
    response_lower = response.lower()
    has_dc = "dc" in response_lower or "solar" in response_lower or "6 mm" in response_lower
    has_ac = "ac" in response_lower or "lv" in response_lower or "mv" in response_lower or "120" in response_lower or "240" in response_lower
    
    if has_dc and has_ac:
        return True, "Contains breakdown with multiple cable types"
    elif has_dc:
        return False, "Only DC cable mentioned, missing AC/MV breakdown"
    elif has_ac:
        return False, "Only AC cable mentioned, missing DC breakdown"
    return False, "No cable breakdown found"


def check_has_citation(response: str) -> tuple[bool, str]:
    """Check if response contains source citations in brackets."""
    # Look for [Source: ...] or [Kaynak: ...] pattern
    if re.search(r'\[(?:Source|Kaynak):', response, re.IGNORECASE):
        return True, "Contains proper source citation"
    # Fallback: just check for any brackets with content
    if '[' in response and ']' in response:
        bracket_content = re.search(r'\[([^\]]+)\]', response)
        if bracket_content:
            return True, f"Contains citation: [{bracket_content.group(1)[:30]}...]"
    return False, "No source citation found in brackets"


def check_no_question_asked(response: str) -> tuple[bool, str]:
    """Check that AI didn't ask a clarifying question."""
    question_indicators = [
        "?", "hangi", "which", "could you", "can you specify",
        "lütfen belirtin", "please specify", "do you mean"
    ]
    response_lower = response.lower()
    
    # Allow ? only if it's quoting the user's question
    question_marks = response.count('?')
    if question_marks > 1:  # Multiple question marks = likely asking questions
        return False, "AI asked clarifying questions"
    
    for phrase in question_indicators[1:]:  # Skip '?' for now
        if phrase in response_lower:
            return False, f"AI asked a question: contains '{phrase}'"
    
    return True, "No clarifying questions asked"


# Define the smart test cases
TEST_CASES = [
    SmartTestCase(
        id="SMART-001",
        query="kabllo kesitii ve tipi nedri?",
        description="TYPO TEST: Typos in cable query - should still find cable specs",
        success_check=lambda r: (
            ("mm" in r.lower() or "kablo" in r.lower() or "cable" in r.lower()) and check_no_confusion(r)[0],
            f"Found cable data: {'mm' in r.lower() or 'kablo' in r.lower()}; {check_no_confusion(r)[1]}"
        ),
        failure_keywords=["anlamadım", "don't understand", "unclear"]
    ),
    SmartTestCase(
        id="SMART-002", 
        query="Kablo metrajı ne?",
        description="AMBIGUITY TEST: Vague question - should give breakdown, NOT ask which cable",
        success_check=lambda r: (
            check_breakdown_given(r)[0] and check_no_question_asked(r)[0],
            f"{check_breakdown_given(r)[1]}; {check_no_question_asked(r)[1]}"
        ),
        failure_keywords=["hangi kablo", "which cable", "could you clarify"]
    ),
    SmartTestCase(
        id="SMART-003",
        query="Panel markası nedir?",
        description="CITATION TEST: Answer must include [Source: ...] citation",
        success_check=lambda r: check_has_citation(r),
        failure_keywords=[]
    ),
    SmartTestCase(
        id="SMART-004",
        query="inveter tipi nedri?",
        description="TYPO TEST #2: Typos in 'inverter' and 'nedir' - should still answer",
        success_check=lambda r: (
            ("sungrow" in r.lower() or "sg350" in r.lower() or "inverter" in r.lower()) 
            and check_no_confusion(r)[0],
            "Found inverter info" if ("sungrow" in r.lower() or "inverter" in r.lower()) else "Missing inverter"
        ),
        failure_keywords=["anlamadım", "don't understand"]
    ),
    SmartTestCase(
        id="SMART-005",
        query="projdeki tüm ekipmanları listele",
        description="BREAKDOWN TEST: Should list multiple equipment types without asking",
        success_check=lambda r: (
            len(re.findall(r'•|[\-\*]|\d\.', r)) >= 2 and check_no_question_asked(r)[0],
            f"Found {len(re.findall(r'•|[-*]|[0-9].', r))} list items"
        ),
        failure_keywords=["hangi", "which", "specify"]
    ),
]


# =============================================================================
# TEST RUNNER
# =============================================================================

def check_server_health() -> bool:
    """Check if the API server is running."""
    try:
        response = requests.get(f"{API_BASE_URL}/health", timeout=5)
        return response.status_code == 200
    except:
        return False


def run_single_test(test: SmartTestCase) -> dict:
    """Execute a single smart test and return results."""
    result = {
        "id": test.id,
        "query": test.query,
        "description": test.description,
        "passed": False,
        "response": None,
        "reason": None,
        "duration_ms": 0
    }
    
    try:
        start_time = time.time()
        
        response = requests.post(
            API_ENDPOINT,
            json={"question": test.query, "mode": "general"},
            timeout=TIMEOUT_SECONDS,
            headers={"Content-Type": "application/json"}
        )
        
        result["duration_ms"] = (time.time() - start_time) * 1000
        
        if response.status_code != 200:
            result["reason"] = f"HTTP {response.status_code}"
            return result
        
        data = response.json()
        answer = data.get("answer", "")
        result["response"] = answer
        
        # Check for failure keywords first
        answer_lower = answer.lower()
        for kw in test.failure_keywords:
            if kw.lower() in answer_lower:
                result["reason"] = f"Contains failure keyword: '{kw}'"
                return result
        
        # Run the success check
        check_result = test.success_check(answer)
        if isinstance(check_result, tuple):
            result["passed"] = check_result[0]
            result["reason"] = check_result[1]
        else:
            result["passed"] = check_result
            result["reason"] = "Check passed" if check_result else "Check failed"
            
    except requests.exceptions.Timeout:
        result["reason"] = f"Timeout after {TIMEOUT_SECONDS}s"
    except Exception as e:
        result["reason"] = f"Error: {str(e)}"
    
    return result


def run_benchmark():
    """Run all smart logic tests."""
    print("\n" + "=" * 70)
    print("🧠 SMART LOGIC BENCHMARK - AI Reasoning Test")
    print("=" * 70)
    print(f"API: {API_ENDPOINT}")
    print(f"Tests: {len(TEST_CASES)}")
    print("=" * 70)
    
    # Health check
    print("\n⏳ Checking server...")
    if not check_server_health():
        print("\n❌ Server not responding!")
        print("   Run: uvicorn app.main:app --reload --port 8000")
        sys.exit(1)
    print("✅ Server healthy!")
    
    # Run tests
    results = []
    print("\n⏳ Running smart logic tests...\n")
    
    for i, test in enumerate(TEST_CASES, 1):
        print(f"[{i}/{len(TEST_CASES)}] {test.id}: {test.description[:50]}...")
        result = run_single_test(test)
        results.append(result)
        status = "✅" if result["passed"] else "❌"
        print(f"       {status} {result['reason'][:60] if result['reason'] else ''}")
    
    # Detailed results
    print("\n" + "=" * 70)
    print("📊 DETAILED RESULTS")
    print("=" * 70)
    
    for r in results:
        status = "✅ PASS" if r["passed"] else "❌ FAIL"
        print(f"\n{'─' * 70}")
        print(f"{status} | {r['id']}: {r['description']}")
        print(f"{'─' * 70}")
        print(f"   Query: {r['query']}")
        print(f"   Duration: {r['duration_ms']:.0f}ms")
        print(f"   Reason: {r['reason']}")
        if r["response"]:
            preview = r["response"][:300].replace('\n', ' ')
            print(f"   Response: {preview}{'...' if len(r['response']) > 300 else ''}")
    
    # Summary
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    pct = (passed / total) * 100 if total else 0
    
    print("\n" + "=" * 70)
    print(f"📈 SCORE: {passed}/{total} PASSED ({pct:.0f}%)")
    print("=" * 70)
    
    if pct == 100:
        print("\n🎉 PERFECT SCORE! AI reasoning is fully operational.")
    elif pct >= 80:
        print("\n⚠️  MOSTLY PASSING - Minor reasoning issues remain.")
    elif pct >= 60:
        print("\n⚠️  PARTIAL - Significant reasoning gaps detected.")
    else:
        print("\n❌ CRITICAL - Major reasoning failures. Check system prompt.")
    
    # Diagnostic for failures
    failures = [r for r in results if not r["passed"]]
    if failures:
        print("\n" + "=" * 70)
        print("🔧 FAILURE ANALYSIS")
        print("=" * 70)
        for f in failures:
            print(f"\n{f['id']}: {f['reason']}")
            if "confusion" in f['reason'].lower() or "understand" in f['reason'].lower():
                print("   → FIX: Strengthen 'Silent Typo Correction' rule in system prompt")
            elif "question" in f['reason'].lower() or "which" in f['reason'].lower():
                print("   → FIX: Reinforce 'DO NOT ASK QUESTIONS' rule in system prompt")
            elif "citation" in f['reason'].lower() or "bracket" in f['reason'].lower():
                print("   → FIX: Enforce mandatory citation format in system prompt")
            elif "breakdown" in f['reason'].lower():
                print("   → FIX: Add 'Smart Breakdown' examples to system prompt")
    
    print("\n")
    return 0 if pct == 100 else 1


if __name__ == "__main__":
    exit_code = run_benchmark()
    sys.exit(exit_code)
