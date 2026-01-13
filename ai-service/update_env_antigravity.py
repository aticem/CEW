import os

env_path = ".env"
if os.path.exists(env_path):
    with open(env_path, "rb") as f:
        content = f.read()
    
    if content.startswith(b"\xef\xbb\xbf"):
        content = content[3:]
    
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    
    lines = text.splitlines()
    new_lines = []
    keys_set = set()
    
    for line in lines:
        if "=" in line:
            key = line.split("=")[0].strip()
            keys_set.add(key)
            
            if key == "LLM_PROVIDER":
                new_lines.append("LLM_PROVIDER=gemini")
            elif key == "GEMINI_API_KEY":
                new_lines.append("GEMINI_API_KEY=AIzaSyDXbxGieNs1OQBUBSwZEn9GRuoz8z7Tip4")
            elif key == "GEMINI_MODEL":
                new_lines.append("GEMINI_MODEL=gemini-3-flash-preview")
            elif key == "EMBEDDING_PROVIDER":
                new_lines.append("EMBEDDING_PROVIDER=gemini")
            elif key == "GEMINI_EMBEDDING_MODEL":
                new_lines.append("GEMINI_EMBEDDING_MODEL=gemini-embedding-001")
            elif key == "OPENAI_API_KEY":
                # Keep it but comment it out since we're full Gemini now
                new_lines.append("# OPENAI_API_KEY=... # Not needed for full Gemini setup")
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)
    
    # Add missing keys
    if "LLM_PROVIDER" not in keys_set:
        new_lines.append("LLM_PROVIDER=gemini")
    if "GEMINI_API_KEY" not in keys_set:
        new_lines.append("GEMINI_API_KEY=AIzaSyDXbxGieNs1OQBUBSwZEn9GRuoz8z7Tip4")
    if "GEMINI_MODEL" not in keys_set:
        new_lines.append("GEMINI_MODEL=gemini-3-flash-preview")
    if "EMBEDDING_PROVIDER" not in keys_set:
        new_lines.append("EMBEDDING_PROVIDER=gemini")
    if "GEMINI_EMBEDDING_MODEL" not in keys_set:
        new_lines.append("GEMINI_EMBEDDING_MODEL=gemini-embedding-001")

    with open(env_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(new_lines))
    print("OK: Updated .env with new Gemini key and models (gemini-embedding-001).")
else:
    print("ERROR: .env not found.")
