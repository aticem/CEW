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
    found_provider = False
    for line in lines:
        if line.startswith("EMBEDDING_PROVIDER="):
            new_lines.append("EMBEDDING_PROVIDER=gemini")
            found_provider = True
        else:
            new_lines.append(line)
    
    if not found_provider:
        new_lines.append("EMBEDDING_PROVIDER=gemini")
    
    with open(env_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(new_lines))
    print("Set EMBEDDING_PROVIDER=gemini in .env.")
else:
    print(".env not found.")
