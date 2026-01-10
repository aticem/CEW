"""
OpenAI LLM service wrapper.
Handles chat completions with the gpt-4o model (Enterprise Mode).
"""
from openai import AsyncOpenAI

from app.config import OPENAI_API_KEY, LLM_MODEL

# Async client
client = None


def get_client() -> AsyncOpenAI:
    """Get or create async OpenAI client."""
    global client
    if client is None:
        client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    return client


async def generate_answer(system_prompt: str, user_prompt: str) -> str:
    """
    Call OpenAI chat completion with system + user prompts.
    
    Uses temperature=0 for deterministic, factual responses.
    
    Args:
        system_prompt: System instructions for the AI
        user_prompt: User's question with context
        
    Returns:
        AI-generated response text
    """
    llm_client = get_client()
    
    # DEBUG: Log prompt details
    print("\n" + "🤖 " + "=" * 78)
    print("LLM REQUEST DETAILS:")
    print("=" * 80)
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
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.0,
        max_tokens=1000
    )
    
    answer = response.choices[0].message.content
    
    # DEBUG: Log response
    print("\n" + "💬 " + "=" * 78)
    print("LLM RESPONSE:")
    print("=" * 80)
    print(answer)
    print("=" * 80 + "\n")
    
    return answer


async def generate_answer_with_history(
    system_prompt: str, 
    messages: list[dict]
) -> str:
    """
    Generate answer with conversation history.
    Reserved for future use when conversation memory is added.
    
    Args:
        system_prompt: System instructions
        messages: List of previous messages [{role, content}, ...]
        
    Returns:
        AI-generated response text
    """
    llm_client = get_client()
    
    all_messages = [{"role": "system", "content": system_prompt}] + messages
    
    response = await llm_client.chat.completions.create(
        model=LLM_MODEL,
        messages=all_messages,
        temperature=0.0,
        max_tokens=1000
    )
    
    return response.choices[0].message.content
