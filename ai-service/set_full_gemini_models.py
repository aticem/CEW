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
    for line in lines:
        if line.startswith("GEMINI_MODEL="):
            new_lines.append("GEMINI_MODEL=gemini-3-flash-preview")
        elif line.startswith("LLM_PROVIDER="):
            new_lines.append("LLM_PROVIDER=gemini")
        elif line.startswith("EMBEDDING_PROVIDER="):
            new_lines.append("EMBEDDING_PROVIDER=gemini")
        elif line.startswith("GEMINI_EMBEDDING_MODEL="):
            new_lines.append("GEMINI_EMBEDDING_MODEL=text-embedding-004")
        else:
            new_lines.append(line)
    
    # Check if any are missing
    keys = [l.split("=")[0] for l in new_lines if "=" in l]
    if "GEMINI_MODEL" not in keys: new_lines.append("GEMINI_MODEL=gemini-3-flash-preview")
    if "LLM_PROVIDER" not in keys: new_lines.append("LLM_PROVIDER=gemini")
    if "EMBEDDING_PROVIDER" not in keys: new_lines.append("EMBEDDING_PROVIDER=gemini")
    if "GEMINI_EMBEDDING_MODEL" not in keys: new_lines.append("GEMINI_EMBEDDING_MODEL=text-embedding-004")

    with open(env_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(new_lines))
    print("Set LLM=gemini-3-flash-preview and Embedding=text-embedding-004 in .env.")
else:
    print(".env not found.")
