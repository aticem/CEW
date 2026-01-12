import sys
import os
from pathlib import Path
from dotenv import load_dotenv

# Base paths
BASE_DIR = Path(__file__).parent
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

sys.path.append(str(BASE_DIR))

# Fix Windows encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import asyncio
from app.services.rag_service import process_rag_query

async def debug():
    # Force LLM_PROVIDER to gemini
    os.environ["LLM_PROVIDER"] = "gemini"
    
    qs = ["lemp nedir", "what is dc/ac ratio orani"]
    for q in qs:
        print(f"\nQUERY: {q}")
        res = await process_rag_query(q)
        print(f"ANSWER: {res['answer']}")

if __name__ == "__main__":
    asyncio.run(debug())
