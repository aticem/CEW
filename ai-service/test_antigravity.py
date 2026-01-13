import sys
import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

sys.path.append(str(BASE_DIR))

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import asyncio
from app.services.rag_service import process_rag_query

async def test_antigravity():
    print("\n" + "="*80)
    print("ANTIGRAVITY MODE TEST - Problematic Questions")
    print("="*80 + "\n")
    
    test_cases = [
        "what is ref for [3]",
        "what is dc/ ratio",
        "lemp nedir",
    ]
    
    for q in test_cases:
        print(f"\n{'='*80}")
        print(f"Q: {q}")
        print(f"{'='*80}")
        try:
            res = await process_rag_query(q)
            answer = res.get('answer', '')
            # Show first 500 chars
            preview = answer[:500].replace('\n', ' ')
            print(f"A: {preview}...")
            print(f"Source: {res.get('source', 'N/A')}")
        except Exception as e:
            print(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(test_antigravity())
