"""
Prompt loading utilities.
"""
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent


def load_prompt(filename: str, language: str = "en") -> str:
    """
    Load prompt from file with language substitution.
    
    Args:
        filename: Name of the prompt file
        language: 'en' or 'tr'
        
    Returns:
        Prompt content with language placeholder replaced
    """
    filepath = PROMPTS_DIR / filename
    
    if not filepath.exists():
        raise FileNotFoundError(f"Prompt file not found: {filepath}")
    
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Replace language placeholder
    if language == "tr":
        content = content.replace("{{LANGUAGE}}", "Turkish")
        content = content.replace("{{FALLBACK_MESSAGE}}", 
            "Bu bilgiyi mevcut belgelerde/kayıtlarda bulamıyorum.")
    else:
        content = content.replace("{{LANGUAGE}}", "English")
        content = content.replace("{{FALLBACK_MESSAGE}}", 
            "I cannot find this information in the provided documents/records.")
    
    return content
