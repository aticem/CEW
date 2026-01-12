#!/usr/bin/env python3
"""
Incremental ingestion for CEW AI-Service.

Unlike scripts/ingest.py (full rebuild), this script:
- Detects new/changed documents via sha256 hash
- Re-ingests ONLY those documents
- Optionally prunes removed docs from Chroma

State is stored inside chroma_db so it stays coupled to the current index:
- ai-service/chroma_db/ingest_manifest.json

Usage:
  cd ai-service
  .\\venv\\Scripts\\Activate.ps1
  python scripts/ingest_incremental.py
  python scripts/ingest_incremental.py --prune-removed
  python scripts/ingest_incremental.py --dry-run
"""

import argparse
import hashlib
import json
import sys
import time
import uuid
from pathlib import Path

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.config import DOCUMENTS_DIR, CHROMA_DIR, CHUNK_SIZE, CHUNK_OVERLAP, EMBEDDING_MODEL  # noqa: E402
from app.services.chroma_service import add_documents, delete_by_doc_name, get_collection_stats  # noqa: E402
from app.services.embedding_service import generate_embedding_sync  # noqa: E402

# Reuse the same parsing logic as full ingest
from scripts.ingest import process_document  # noqa: E402


SUPPORTED_EXTENSIONS = {".pdf", ".xlsx", ".xls", ".docx"}
MANIFEST_PATH = CHROMA_DIR / "ingest_manifest.json"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        return {"version": 1, "files": {}, "config": {}}
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 1, "files": {}, "config": {}}


def save_manifest(m: dict) -> None:
    CHROMA_DIR.mkdir(exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Incremental ingest for ai-service/documents")
    ap.add_argument("--dry-run", action="store_true", help="Show what would be ingested, but do not change Chroma.")
    ap.add_argument(
        "--prune-removed",
        action="store_true",
        help="If a previously-ingested document is no longer in documents/, delete its chunks from Chroma.",
    )
    args = ap.parse_args()

    if not DOCUMENTS_DIR.exists():
        DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
        print(f"Created empty documents folder: {DOCUMENTS_DIR}")
        return 0

    files = sorted([p for p in DOCUMENTS_DIR.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS])
    if not files:
        print(f"No supported documents found in {DOCUMENTS_DIR}")
        return 0

    manifest = load_manifest()
    manifest.setdefault("files", {})
    manifest.setdefault("config", {})

    current_config = {
        "chunk_size": CHUNK_SIZE,
        "chunk_overlap": CHUNK_OVERLAP,
        "embedding_model": EMBEDDING_MODEL,
    }
    prior_config = manifest.get("config") or {}

    config_changed = prior_config != current_config
    if config_changed:
        print("⚠️  Index config changed since last ingest (chunking/embedding model).")
        print("    Incremental ingest can still run, but for best results consider full rebuild: python scripts/ingest.py")

    on_disk_names = {p.name for p in files}
    known_names = set((manifest.get("files") or {}).keys())

    to_prune = sorted(list(known_names - on_disk_names))
    to_process = []

    print("=" * 70)
    print("  CEW AI-SERVICE — INCREMENTAL INGEST")
    print("=" * 70)
    print(f"Documents on disk: {len(files)}")
    print(f"Manifest entries:  {len(known_names)}")

    for p in files:
        doc_name = p.name
        stat = p.stat()
        digest = sha256_file(p)

        prev = (manifest["files"] or {}).get(doc_name)
        changed = (prev is None) or (prev.get("sha256") != digest)
        if changed:
            to_process.append((p, digest, stat.st_size, int(stat.st_mtime)))

    print(f"Changed/new documents: {len(to_process)}")
    if args.prune_removed:
        print(f"Removed documents to prune: {len(to_prune)}")

    if args.dry_run:
        for p, digest, size, mtime in to_process:
            print(f"[DRY-RUN] would ingest: {p.name} (sha256={digest[:12]}..., size={size})")
        if args.prune_removed:
            for dn in to_prune:
                print(f"[DRY-RUN] would prune: {dn}")
        return 0

    # Prune removed docs
    if args.prune_removed:
        for dn in to_prune:
            print(f"🗑️  Pruning removed doc from Chroma: {dn}")
            delete_by_doc_name(dn)
            manifest["files"].pop(dn, None)

    # Process changed docs
    total_added = 0
    for p, digest, size, mtime in to_process:
        print(f"\n📁 Ingesting: {p.name}")
        start = time.time()

        # Replace this doc’s chunks in Chroma
        delete_by_doc_name(p.name)

        chunks = process_document(p)
        if not chunks:
            print("   ⚠️  No chunks extracted; skipping manifest update.")
            continue

        docs_to_add = []
        for i, chunk in enumerate(chunks):
            try:
                embedding = generate_embedding_sync(chunk["text"])
            except Exception as e:
                print(f"   ⚠️  Embedding error for chunk {i}: {e}")
                continue

            page_or_sheet = chunk.get("page") or chunk.get("sheet") or chunk.get("section") or "0"
            unique_suffix = uuid.uuid4().hex[:8]
            doc_id = f"{chunk['doc_name']}_{page_or_sheet}_{chunk['chunk_index']}_{unique_suffix}"

            metadata = {"doc_name": chunk["doc_name"], "chunk_index": chunk["chunk_index"]}
            for key in ["page", "sheet", "section", "table_num", "row_num", "doc_type", "pdf_kind"]:
                if key in chunk:
                    metadata[key] = chunk[key]

            docs_to_add.append({"id": doc_id, "text": chunk["text"], "embedding": embedding, "metadata": metadata})

        if docs_to_add:
            add_documents(docs_to_add)
            total_added += len(docs_to_add)

        manifest["files"][p.name] = {
            "sha256": digest,
            "size": size,
            "mtime": mtime,
            "chunks": len(docs_to_add),
            "indexed_at": int(time.time()),
        }

        elapsed = time.time() - start
        print(f"   ✅ Done: {len(docs_to_add)} chunks ({elapsed:.1f}s)")

    manifest["config"] = current_config
    save_manifest(manifest)

    stats = get_collection_stats()
    print("\n" + "=" * 70)
    print("  ✅ INCREMENTAL INGEST COMPLETE")
    print("=" * 70)
    print(f"Added chunks:        {total_added}")
    print(f"ChromaDB documents:  {stats.get('count', 0)}")
    print(f"Manifest:            {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

