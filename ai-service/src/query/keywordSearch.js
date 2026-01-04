export function keywordSearch(chunks, question, options = {}) {
  const { maxResults = 5, minScore = 1 } = options;

  const q = normalize(question);
  const qTerms = q.split(" ").filter(Boolean);

  const scored = chunks.map((chunk) => {
    const text = normalize(chunk.text ?? "");
    let score = 0;

    for (const term of qTerms) {
      if (text.includes(term)) score += 1;
    }

    return { chunk, score };
  });

  return scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((r) => ({ score: r.score, ...r.chunk }));
}

function normalize(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")  // Unicode uyumlu (Türkçe karakterler korunur)
    .replace(/\s+/g, " ")
    .trim();
}
