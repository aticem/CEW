import { ChromaClient } from "chromadb";

export function getChroma() {
  const url = process.env.CHROMA_URL || "http://localhost:8000";
  return new ChromaClient({ path: url });
}

export async function getOrCreateCollection() {
  const chroma = getChroma();
  const name = process.env.CHROMA_COLLECTION || "cew_docs_dev";
  return await chroma.getOrCreateCollection({ name });
}
