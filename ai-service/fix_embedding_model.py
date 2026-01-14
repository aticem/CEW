#!/usr/bin/env python3
"""
Fix the Gemini embedding model name in .env file.
"""
import re
from pathlib import Path

def fix_embedding_model():
    env_path = Path(__file__).parent / ".env"

    if not env_path.exists():
        print("❌ .env file not found!")
        return

    # Read current content
    with open(env_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace the wrong model name
    old_pattern = r'GEMINI_EMBEDDING_MODEL=gemini-embedding-001'
    new_pattern = 'GEMINI_EMBEDDING_MODEL=text-embedding-004'

    if old_pattern in content:
        new_content = content.replace(old_pattern, new_pattern)
        with open(env_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("OK: Fixed GEMINI_EMBEDDING_MODEL from 'gemini-embedding-001' to 'text-embedding-004'")
    else:
        print("INFO: GEMINI_EMBEDDING_MODEL already has correct value or not found")

if __name__ == "__main__":
    fix_embedding_model()