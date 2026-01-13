"""
LLM service wrapper.

Supports:
- OpenAI chat completions (default)
- Gemini via Google Generative Language REST API (API-key based)
"""

import httpx
from openai import AsyncOpenAI

from app.config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    LLM_MODEL,
    LLM_PROVIDER,
    OPENAI_API_KEY,
)

# Async OpenAI client (lazy)
_openai_client = None


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    return _openai_client


async def _generate_answer_openai(system_prompt: str, user_prompt: str) -> str:
    llm_client = _get_openai_client()

    # DEBUG: Log prompt details
    print("\n" + "🤖 " + "=" * 78)
    print("LLM REQUEST DETAILS:")
    print("=" * 80)
    print(f"Provider: openai")
    print(f"Model: {LLM_MODEL}")
    print(f"Temperature: 0.0")
    print(f"System prompt length: {len(system_prompt)} chars")
    print(f"User prompt length: {len(user_prompt)} chars")
    print(f"\nSystem prompt (first 300 chars):")
    print(system_prompt[:300] + ("..." if len(system_prompt) > 300 else ""))
    print("=" * 80 + "\n")

    response = await llm_client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.0,
        max_tokens=3000,  # Increased from 1000 to allow complete answers for detailed lists
    )
    answer = response.choices[0].message.content

    # DEBUG: Log response
    print("\n" + "💬 " + "=" * 78)
    print("LLM RESPONSE:")
    print("=" * 80)
    print(answer)
    print("=" * 80 + "\n")

    return answer


async def _generate_answer_gemini(system_prompt: str, user_prompt: str) -> str:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is missing. Set it in ai-service/.env")

    # Google Generative Language API (API-key based)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    params = {"key": GEMINI_API_KEY}

    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 3000},  # Increased from 1000 to allow complete answers for detailed lists
    }

    # DEBUG: Log prompt details (never log keys)
    print("\n" + "🤖 " + "=" * 78)
    print("LLM REQUEST DETAILS:")
    print("=" * 80)
    print(f"Provider: gemini")
    print(f"Model: {GEMINI_MODEL}")
    print(f"Temperature: 0.0")
    print(f"System prompt length: {len(system_prompt)} chars")
    print(f"User prompt length: {len(user_prompt)} chars")
    print("=" * 80 + "\n")

    async with httpx.AsyncClient(timeout=90.0) as c:
        r = await c.post(url, params=params, json=payload)
        try:
            r.raise_for_status()
        except Exception as e:
            raise RuntimeError(f"Gemini API error: {r.status_code} {r.text}") from e
        data = r.json()

    try:
        answer = data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        raise RuntimeError(f"Gemini response parse failed: {data}") from e

    # DEBUG: Log response
    print("\n" + "💬 " + "=" * 78)
    print("LLM RESPONSE:")
    print("=" * 80)
    print(answer)
    print("=" * 80 + "\n")

    return answer


async def generate_answer(system_prompt: str, user_prompt: str) -> str:
    if (LLM_PROVIDER or "openai") == "gemini":
        return await _generate_answer_gemini(system_prompt, user_prompt)
    return await _generate_answer_openai(system_prompt, user_prompt)


async def generate_answer_with_history(system_prompt: str, messages: list[dict]) -> str:
    """
    Generate answer with conversation history.
    - OpenAI: sends multi-message chat.
    - Gemini: flattens history into a single user prompt (good enough for now).
    """
    if (LLM_PROVIDER or "openai") == "gemini":
        flattened = []
        for m in messages or []:
            role = (m.get("role") or "user").upper()
            content = m.get("content") or ""
            flattened.append(f"{role}:\n{content}")
        return await _generate_answer_gemini(system_prompt, "\n\n".join(flattened))

    llm_client = _get_openai_client()
    all_messages = [{"role": "system", "content": system_prompt}] + (messages or [])
    response = await llm_client.chat.completions.create(
        model=LLM_MODEL,
        messages=all_messages,
        temperature=0.0,
        max_tokens=3000,  # Increased from 1000 to allow complete answers for detailed lists
    )
    return response.choices[0].message.content
