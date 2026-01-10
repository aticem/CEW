"""
Data analysis pipeline for 'progress' mode.
Uses Pandas to analyze mock_db.py data and LLM to generate summaries.
Supports real-time screen_context injection for accurate answers.
"""
import json
import pandas as pd
from typing import Optional

from data.mock_db import get_all_progress
from app.services.llm_service import generate_answer
from app.utils.language_detect import detect_language, get_fallback_message
from app.prompts import load_prompt


async def process_data_query(
    question: str, 
    screen_context: Optional[dict] = None
) -> dict:
    """
    Process a question about progress data.
    
    Steps:
    1. Check for screen_context (real-time data from user's screen)
    2. Load progress data into Pandas DataFrame
    3. Detect language (EN/TR)
    4. Build comprehensive data summary
    5. Build prompt with context + data
    6. Call LLM to analyze and answer
    7. Return answer
    
    Args:
        question: User's natural language question about progress
        screen_context: Optional dict with real-time data from user's screen
        
    Returns:
        Dict with 'answer' and 'source' keys
    """
    # Step 1: Detect language
    language = detect_language(question)
    
    # Step 2: Build screen context section if provided
    screen_context_section = ""
    source = "CEW Progress Database"
    
    if screen_context:
        screen_context_section = build_screen_context_section(screen_context)
        source = f"User Screen ({screen_context.get('module', 'Current Module')})"
    
    # Step 3: Load historical data
    data = get_all_progress()
    df = pd.DataFrame(data)
    
    # Step 4: Build data summary
    data_summary = ""
    if not df.empty:
        data_summary = build_data_summary(df)
    
    # Step 5: Build prompt with priority to screen context
    system_prompt = load_prompt("system_progress.txt", language=language)
    
    # Inject screen context priority instruction
    if screen_context_section:
        system_prompt = f"""{system_prompt}

IMPORTANT - REAL-TIME SCREEN DATA:
The user is currently viewing a specific module on their screen. 
When they ask about "total", "completed", "remaining", "progress", or "percentage", 
ALWAYS use the SCREEN CONTEXT data below as the primary source.
The screen context shows what the user is actually seeing right now.
"""
    
    user_prompt = build_user_prompt(question, screen_context_section, data_summary)
    
    # Step 6: Call LLM
    try:
        answer = await generate_answer(system_prompt, user_prompt)
    except Exception as e:
        return {
            "answer": f"Error generating answer: {str(e)}",
            "source": None
        }
    
    # Step 7: Return answer with source
    return {"answer": answer, "source": source}


def build_screen_context_section(screen_context: dict) -> str:
    """
    Build a formatted section from the screen context data.
    
    Args:
        screen_context: Dict with keys like module, total, completed, remaining, unit
        
    Returns:
        Formatted string for the LLM prompt
    """
    lines = ["=== REAL-TIME SCREEN CONTEXT (PRIMARY SOURCE) ==="]
    lines.append("This is what the user is currently seeing on their screen:")
    lines.append("")
    
    # Module name
    if "module" in screen_context:
        lines.append(f"📍 Current Module: {screen_context['module']}")
    
    # Progress metrics
    if "total" in screen_context:
        unit = screen_context.get("unit", "units")
        lines.append(f"📊 Total Scope: {screen_context['total']:,} {unit}")
    
    if "completed" in screen_context:
        unit = screen_context.get("unit", "units")
        lines.append(f"✅ Completed: {screen_context['completed']:,} {unit}")
    
    if "remaining" in screen_context:
        unit = screen_context.get("unit", "units")
        lines.append(f"⏳ Remaining: {screen_context['remaining']:,} {unit}")
    
    # Calculate percentage if we have total and completed
    if "total" in screen_context and "completed" in screen_context:
        total = screen_context["total"]
        completed = screen_context["completed"]
        if total > 0:
            pct = (completed / total) * 100
            lines.append(f"📈 Progress: {pct:.1f}%")
    
    # Additional fields
    for key, value in screen_context.items():
        if key not in ["module", "total", "completed", "remaining", "unit"]:
            lines.append(f"• {key}: {value}")
    
    lines.append("")
    lines.append("⚠️ USE THIS DATA to answer questions about current progress!")
    lines.append("=" * 50)
    
    return "\n".join(lines)


def build_user_prompt(
    question: str, 
    screen_context_section: str, 
    data_summary: str
) -> str:
    """
    Build the user prompt with screen context prioritized.
    """
    parts = [f"QUESTION:\n{question}\n"]
    
    # Screen context comes first (priority)
    if screen_context_section:
        parts.append(screen_context_section)
        parts.append("")
    
    # Historical data comes second
    if data_summary:
        parts.append("=== HISTORICAL DATABASE RECORDS ===")
        parts.append("(Use only if screen context doesn't have the answer)")
        parts.append(data_summary)
    
    parts.append("\nAnswer the question using the data above. Prioritize SCREEN CONTEXT if available.")
    
    return "\n".join(parts)


def build_data_summary(df: pd.DataFrame) -> str:
    """
    Build a comprehensive summary of the progress data for the LLM.
    
    Args:
        df: Pandas DataFrame with progress data
        
    Returns:
        Formatted string with data summary and statistics
    """
    # Basic info
    subcontractors = df["subcontractor_code"].unique().tolist()
    date_range = f"{df['date'].min()} to {df['date'].max()}"
    total_records = len(df)
    
    # Per-subcontractor summary
    sub_summary = df.groupby("subcontractor_code").agg({
        "amount_done": ["sum", "mean", "count"],
        "worker_count": ["sum", "mean"],
        "unit": "first"
    }).round(2)
    
    sub_summary_str = []
    for sub in subcontractors:
        sub_data = df[df["subcontractor_code"] == sub]
        total_amount = sub_data["amount_done"].sum()
        avg_amount = sub_data["amount_done"].mean()
        total_workers = sub_data["worker_count"].sum()
        avg_workers = sub_data["worker_count"].mean()
        unit = sub_data["unit"].iloc[0]
        days_worked = len(sub_data)
        
        sub_summary_str.append(
            f"  {sub}: Total={total_amount:,.2f} {unit}, "
            f"Avg/day={avg_amount:,.2f} {unit}, "
            f"Days={days_worked}, "
            f"Total Workers={total_workers}, "
            f"Avg Workers/day={avg_workers:.1f}"
        )
    
    # Daily totals
    daily_summary = df.groupby("date").agg({
        "amount_done": "sum",
        "worker_count": "sum"
    }).round(2)
    
    summary = f"""
=== DATA OVERVIEW ===
Total Records: {total_records}
Date Range: {date_range}
Subcontractors: {', '.join(subcontractors)}

=== PER-SUBCONTRACTOR SUMMARY ===
{chr(10).join(sub_summary_str)}

=== DAILY TOTALS ===
{daily_summary.to_string()}

=== RAW DATA (ALL RECORDS) ===
{df.to_string(index=False)}

=== DATA AS JSON ===
{df.to_json(orient='records', indent=2)}
"""
    
    return summary
