#!/usr/bin/env python3
"""
Check current .env configuration.
"""
from pathlib import Path
import os

def check_env():
    env_path = Path(__file__).parent / ".env"

    if not env_path.exists():
        print("ERROR: .env file not found!")
        return

    # Load environment variables from .env
    from dotenv import load_dotenv
    load_dotenv(env_path)

    print("Current .env configuration:")
    print(f"LLM_PROVIDER: {os.getenv('LLM_PROVIDER')}")
    print(f"GEMINI_API_KEY: {os.getenv('GEMINI_API_KEY')[:10] if os.getenv('GEMINI_API_KEY') else 'NOT SET'}...")
    print(f"GEMINI_MODEL: {os.getenv('GEMINI_MODEL')}")
    print(f"EMBEDDING_PROVIDER: {os.getenv('EMBEDDING_PROVIDER')}")
    print(f"GEMINI_EMBEDDING_MODEL: {os.getenv('GEMINI_EMBEDDING_MODEL')}")

if __name__ == "__main__":
    check_env()