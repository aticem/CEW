#!/usr/bin/env python3
"""
Automatic RAG Test System

Generates test questions from documents and validates RAG responses.
Supports Turkish, English, and mixed-language questions.

Usage:
    python scripts/auto_test_rag.py                    # One-time test
    python scripts/auto_test_rag.py --watch            # Watch mode (future)
    python scripts/auto_test_rag.py --generate-questions  # Generate test cases only
"""
import sys
import json
import re
import asyncio
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime

# Fix Windows console encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.chroma_service import get_collection
from app.services.rag_service import process_rag_query
from app.utils.text_utils import extract_keywords


def extract_test_candidates_from_chroma() -> List[Dict[str, Any]]:
    """
    Extract test candidates from ChromaDB:
    - Key-value pairs from DATA rows
    - Document titles (section_type: "title")
    - Section headers
    """
    collection = get_collection()
    # Note: ChromaDB automatically returns ids, don't include it in include parameter
    all_docs = collection.get(limit=2000, include=["documents", "metadatas"])
    
    candidates = []
    
    if not all_docs["ids"]:
        return candidates
    
    for i, doc_id in enumerate(all_docs["ids"]):
        doc_text = all_docs["documents"][i] or ""
        metadata = all_docs["metadatas"][i] or {}
        section_type = metadata.get("section_type")
        
        # Extract key-value pairs from DATA rows
        if "DATA:" in doc_text:
            # Parse DATA: Key1: Value1, Key2: Value2 format
            data_match = re.search(r"DATA:\s*(.+)", doc_text)
            if data_match:
                data_str = data_match.group(1)
                # Simple parsing: split by comma, then by colon
                pairs = []
                for part in data_str.split(","):
                    if ":" in part:
                        key, value = part.split(":", 1)
                        key = key.strip()
                        value = value.strip()
                        if key and value and len(key) < 100 and len(value) < 200:
                            pairs.append({"key": key, "value": value, "source": doc_text[:200]})
                
                if pairs:
                    candidates.append({
                        "type": "key_value",
                        "pairs": pairs,
                        "metadata": metadata
                    })
        
        # Extract titles (section_type: "title")
        if section_type == "title":
            # Extract title from first line or section name
            title_match = re.search(r"(?:SOURCE:|SECTION:)\s*([^\n|]+)", doc_text)
            if title_match:
                title = title_match.group(1).strip()
                if title and len(title) < 200:
                    candidates.append({
                        "type": "title",
                        "title": title,
                        "metadata": metadata
                    })
        
        # Extract section names
        section_match = re.search(r"SECTION:\s*([^\n|]+)", doc_text)
        if section_match:
            section_name = section_match.group(1).strip()
            if section_name and len(section_name) < 200:
                candidates.append({
                    "type": "section",
                    "section": section_name,
                    "metadata": metadata
                })
    
    return candidates


def generate_questions(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Generate test questions from candidates.
    Returns Turkish, English, and mixed questions.
    """
    questions = []
    
    for candidate in candidates:
        if candidate["type"] == "key_value":
            for pair in candidate.get("pairs", []):
                key = pair["key"]
                value = pair["value"]
                
                # Skip low-signal keys
                if any(skip in key.lower() for skip in ["column_", "unnamed", "unnamed:"]):
                    continue
                
                # Turkish questions
                questions.append({
                    "question": f"{key} nedir?",
                    "language": "tr",
                    "expected_keywords": [key.lower(), value.lower()[:50]],
                    "candidate_type": "key_value"
                })
                questions.append({
                    "question": f"{key} kaçtır?",
                    "language": "tr",
                    "expected_keywords": [key.lower(), value.lower()[:50]],
                    "candidate_type": "key_value"
                })
                
                # English questions
                questions.append({
                    "question": f"What is {key}?",
                    "language": "en",
                    "expected_keywords": [key.lower(), value.lower()[:50]],
                    "candidate_type": "key_value"
                })
                questions.append({
                    "question": f"What is the value of {key}?",
                    "language": "en",
                    "expected_keywords": [key.lower(), value.lower()[:50]],
                    "candidate_type": "key_value"
                })
        
        elif candidate["type"] == "title":
            title = candidate["title"]
            # Extract acronym or key term from title
            words = title.split()
            if len(words) > 0:
                main_term = words[0] if len(words[0]) > 3 else " ".join(words[:2])
                
                questions.append({
                    "question": f"{main_term} nedir?",
                    "language": "tr",
                    "expected_keywords": [main_term.lower()],
                    "candidate_type": "title"
                })
                questions.append({
                    "question": f"What is {main_term}?",
                    "language": "en",
                    "expected_keywords": [main_term.lower()],
                    "candidate_type": "title"
                })
        
        elif candidate["type"] == "section":
            section = candidate["section"]
            if "references" in section.lower() or "reference" in section.lower():
                # Generate reference questions
                questions.append({
                    "question": "what is ref for [3]",
                    "language": "en",
                    "expected_keywords": ["reference", "ref"],
                    "candidate_type": "section"
                })
    
    # Deduplicate questions
    seen = set()
    unique_questions = []
    for q in questions:
        q_key = q["question"].lower().strip()
        if q_key not in seen:
            seen.add(q_key)
            unique_questions.append(q)
    
    return unique_questions


async def run_test(question_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run a single test question through RAG pipeline.
    """
    question = question_data["question"]
    expected_keywords = question_data.get("expected_keywords", [])
    
    try:
        result = await process_rag_query(question)
        answer = result.get("answer", "")
        source = result.get("source", "")
        
        # Check for fallback
        answer_lower = answer.lower()
        is_fallback = bool(re.search(
            r"\b(cannot find|can't find|could not find|bulamıyorum|bulamadım|bulunamıyor|i cannot find)\b",
            answer_lower
        ))
        
        # Check for citation
        has_citation = bool(re.search(r"\[(?:Source|Kaynak):", answer, re.IGNORECASE))
        
        # Check for expected keywords
        keyword_matches = []
        answer_lower_check = answer_lower
        for kw in expected_keywords:
            if kw.lower() in answer_lower_check:
                keyword_matches.append(kw)
        
        # Determine pass/fail
        passed = True
        fail_reasons = []
        
        if is_fallback:
            passed = False
            fail_reasons.append("FALLBACK")
        
        if not has_citation:
            fail_reasons.append("NO_CITATION")
        
        if expected_keywords and not keyword_matches:
            fail_reasons.append("NO_EXPECTED_KEYWORD")
        
        return {
            "question": question,
            "answer": answer[:300],  # Truncate for readability
            "source": source,
            "passed": passed,
            "fail_reasons": fail_reasons,
            "has_citation": has_citation,
            "keyword_matches": keyword_matches,
            "expected_keywords": expected_keywords,
            "is_fallback": is_fallback
        }
    
    except Exception as e:
        return {
            "question": question,
            "answer": f"ERROR: {str(e)}",
            "source": None,
            "passed": False,
            "fail_reasons": ["EXCEPTION"],
            "error": str(e)
        }


async def run_test_suite(questions: List[Dict[str, Any]], max_questions: Optional[int] = None) -> Dict[str, Any]:
    """
    Run full test suite.
    """
    if max_questions:
        questions = questions[:max_questions]
    
    print(f"\n{'='*80}")
    print(f"Running {len(questions)} test questions...")
    print(f"{'='*80}\n")
    
    results = []
    for i, q_data in enumerate(questions, 1):
        print(f"[{i}/{len(questions)}] Testing: {q_data['question']}")
        result = await run_test(q_data)
        results.append(result)
        
        status = "✓ PASS" if result["passed"] else "✗ FAIL"
        print(f"  {status} - {', '.join(result.get('fail_reasons', [])) or 'OK'}")
    
    # Calculate statistics
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = total - passed
    
    pass_rate = (passed / total * 100) if total > 0 else 0
    
    fail_reasons_count = {}
    for r in results:
        for reason in r.get("fail_reasons", []):
            fail_reasons_count[reason] = fail_reasons_count.get(reason, 0) + 1
    
    return {
        "timestamp": datetime.now().isoformat(),
        "total": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": pass_rate,
        "fail_reasons": fail_reasons_count,
        "results": results
    }


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Automatic RAG Test System")
    parser.add_argument("--generate-questions", action="store_true", help="Generate test questions only")
    parser.add_argument("--max-questions", type=int, help="Limit number of test questions")
    parser.add_argument("--output", type=str, help="Output JSON file for results")
    
    args = parser.parse_args()
    
    # Extract candidates from ChromaDB
    print("Extracting test candidates from ChromaDB...")
    candidates = extract_test_candidates_from_chroma()
    print(f"Found {len(candidates)} candidates")
    
    # Generate questions
    print("Generating test questions...")
    questions = generate_questions(candidates)
    print(f"Generated {len(questions)} unique questions")
    
    if args.generate_questions:
        # Just print questions
        print("\nGenerated Questions:")
        for q in questions[:50]:  # Show first 50
            print(f"  - {q['question']} ({q['language']})")
        return
    
    # Run tests
    async def run():
        test_results = await run_test_suite(questions, max_questions=args.max_questions)
        
        # Print summary
        print(f"\n{'='*80}")
        print("TEST SUMMARY")
        print(f"{'='*80}")
        print(f"Total: {test_results['total']}")
        print(f"Passed: {test_results['passed']}")
        print(f"Failed: {test_results['failed']}")
        print(f"Pass Rate: {test_results['pass_rate']:.1f}%")
        print(f"\nFail Reasons:")
        for reason, count in test_results['fail_reasons'].items():
            print(f"  {reason}: {count}")
        
        # Show sample failures
        failures = [r for r in test_results['results'] if not r['passed']]
        if failures:
            print(f"\nSample Failures (first 5):")
            for f in failures[:5]:
                print(f"  Q: {f['question']}")
                print(f"  A: {f['answer'][:150]}...")
                print(f"  Reasons: {', '.join(f.get('fail_reasons', []))}")
                print()
        
        # Save results
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(test_results, f, indent=2, ensure_ascii=False)
            print(f"\nResults saved to {args.output}")
    
    asyncio.run(run())


if __name__ == "__main__":
    main()
