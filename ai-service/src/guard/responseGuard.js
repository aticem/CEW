/**
 * Response Guard — "Dokümanda yoksa cevap verme" kuralını uygular
 * Bu modül LLM'den ÖNCE çalışır ve hallucination'ı engeller.
 */

export function shouldAnswer(results, options = {}) {
  const {
    minScore = 2,
    minChunks = 1,
    minTopScore = 2
  } = options;

  if (!results || results.length === 0) {
    return { allowed: false, reason: "NO_RESULTS" };
  }

  if (results.length < minChunks) {
    return { allowed: false, reason: "INSUFFICIENT_CHUNKS" };
  }

  const topScore = results[0]?.score ?? 0;
  if (topScore < minTopScore) {
    return { allowed: false, reason: "LOW_RELEVANCE", topScore };
  }

  return { allowed: true, reason: "OK", topScore, chunkCount: results.length };
}

export function getRefusalMessage(reason) {
  const messages = {
    NO_RESULTS: "This information was not found in the uploaded documents.",
    INSUFFICIENT_CHUNKS: "Not enough relevant information found to provide an accurate answer.",
    LOW_RELEVANCE: "The available documents do not contain sufficiently relevant information for this question.",
    DEFAULT: "I cannot answer this question based on the available documents."
  };

  return messages[reason] || messages.DEFAULT;
}

export function isDangerousQuestion(question) {
  const dangerousPatterns = [
    /who.*(responsible|liable|fault)/i,
    /contract.*(breach|violation|penalty)/i,
    /legal.*(action|liability|obligation)/i,
    /comply|compliance|non-compliance/i,
    /guarantee|warranty/i,
    /deadline.*(miss|penalty)/i
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(question)) {
      return {
        isDangerous: true,
        warning: "This question touches on contractual/legal matters. AI will only provide document references, not interpretations."
      };
    }
  }

  return { isDangerous: false };
}
