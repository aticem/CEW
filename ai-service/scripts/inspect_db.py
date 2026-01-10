#!/usr/bin/env python3
"""
ChromaDB Inspector Script

Inspects the contents of the ChromaDB collection to verify structured ingestion.
Shows the first N documents with their content and metadata.

Usage:
    cd ai-service
    python scripts/inspect_db.py
"""
import sys
from pathlib import Path

# Fix Windows console encoding for Unicode
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.chroma_service import get_collection, get_collection_stats


def inspect_chromadb(num_docs: int = 5):
    """
    Inspect ChromaDB collection and display contents.
    
    Args:
        num_docs: Number of documents to display
    """
    print("=" * 80)
    print("  CHROMADB COLLECTION INSPECTOR")
    print("=" * 80)
    
    try:
        # Get collection stats
        stats = get_collection_stats()
        print(f"\n📊 Collection Stats:")
        print(f"   Name:  {stats.get('name', 'N/A')}")
        print(f"   Count: {stats.get('count', 0)} documents")
        
        # Get collection
        collection = get_collection()
        
        # Query for first N documents
        print(f"\n📄 Fetching first {num_docs} documents...")
        
        results = collection.get(
            limit=num_docs,
            include=["documents", "metadatas"]
        )
        
        if not results["ids"]:
            print("\n   ⚠️  No documents found in collection")
            print("   Run: python scripts/ingest.py")
            return
        
        # Display documents
        print(f"\n" + "=" * 80)
        print(f"  DOCUMENT CONTENTS")
        print("=" * 80)
        
        for i, doc_id in enumerate(results["ids"], start=1):
            doc_text = results["documents"][i-1]
            metadata = results["metadatas"][i-1]
            
            print(f"\n{'─' * 80}")
            print(f"📌 Document #{i}")
            print(f"{'─' * 80}")
            print(f"ID: {doc_id}")
            print(f"\n🏷️  Metadata:")
            for key, value in metadata.items():
                print(f"   {key}: {value}")
            
            print(f"\n📝 Content Preview (first 500 chars):")
            print("─" * 80)
            content_preview = doc_text[:500]
            print(content_preview)
            if len(doc_text) > 500:
                print("...")
                print(f"\n   (Total length: {len(doc_text)} characters)")
            print("─" * 80)
        
        # Check if content is structured
        print(f"\n" + "=" * 80)
        print(f"  STRUCTURE ANALYSIS")
        print("=" * 80)
        
        structured_count = 0
        for doc_text in results["documents"]:
            if "SOURCE:" in doc_text and ("DATA:" in doc_text or "CONTENT:" in doc_text):
                structured_count += 1
        
        structure_pct = (structured_count / len(results["documents"])) * 100
        
        print(f"\n✅ Structured Documents: {structured_count}/{len(results['documents'])} ({structure_pct:.0f}%)")
        
        if structure_pct >= 80:
            print("   🎉 Great! Most documents use structured format (key-value pairs)")
        elif structure_pct >= 50:
            print("   ⚠️  Mixed: Some documents are structured, some are raw text")
        else:
            print("   ⚠️  Warning: Most documents appear to be raw text")
            print("   💡 Consider re-running ingestion with structured parser")
        
        print("\n" + "=" * 80)
        
    except Exception as e:
        print(f"\n❌ Error inspecting ChromaDB: {e}")
        import traceback
        traceback.print_exc()


def main():
    """Main function with argument parsing."""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Inspect ChromaDB collection contents"
    )
    parser.add_argument(
        "-n", "--num-docs",
        type=int,
        default=5,
        help="Number of documents to display (default: 5)"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Display all documents in collection"
    )
    
    args = parser.parse_args()
    
    # Get total count if --all is specified
    if args.all:
        try:
            stats = get_collection_stats()
            args.num_docs = stats.get("count", 5)
        except:
            pass
    
    inspect_chromadb(num_docs=args.num_docs)


if __name__ == "__main__":
    main()
