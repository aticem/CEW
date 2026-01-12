import os

env_path = ".env"
if os.path.exists(env_path):
    with open(env_path, "rb") as f:
        content = f.read()
    
    # Remove UTF-8 BOM if present
    if content.startswith(b"\xef\xbb\xbf"):
        content = content[3:]
    
    # Convert to string and split lines
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    
    lines = text.splitlines()
    new_lines = []
    for line in lines:
        if line.startswith("LLM_PROVIDER="):
            new_lines.append("LLM_PROVIDER=gemini")
        elif line.startswith("GEMINI_MODEL="):
            new_lines.append("GEMINI_MODEL=gemini-1.5-flash")
        elif line.startswith("GEMINI_API_KEY="):
            new_lines.append("GEMINI_API_KEY=AIzaSyC8g9voICpoIhcU53qfJ7FnRccWE5aSATQ")
        else:
            new_lines.append(line)
    
    # Add if missing
    keys = [l.split("=")[0] for l in new_lines if "=" in l]
    if "LLM_PROVIDER" not in keys: new_lines.append("LLM_PROVIDER=gemini")
    if "GEMINI_MODEL" not in keys: new_lines.append("GEMINI_MODEL=gemini-1.5-flash")
    if "GEMINI_API_KEY" not in keys: new_lines.append("GEMINI_API_KEY=AIzaSyC8g9voICpoIhcU53qfJ7FnRccWE5aSATQ")
    
    with open(env_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(new_lines))
    print("Fixed .env with Python (No BOM, clean lines).")
else:
    print(".env not found.")
