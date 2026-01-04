/**
 * Answer Composer — Chunk'ları LLM context'ine hazırlar
 */

const DEFAULT_MAX_CHARS = 12000;

export function buildContext(chunks, options = {}) {
  const { maxChars = DEFAULT_MAX_CHARS } = options;

  let context = "";
  const usedChunks = [];

  for (const chunk of chunks) {
    const docRef = `[${chunk.docName}${chunk.page ? ` - Page ${chunk.page}` : ""}]`;
    const addition = `${docRef}\n${chunk.text}\n\n---\n\n`;

    if ((context + addition).length > maxChars) {
      break;
    }

    context += addition;
    usedChunks.push(chunk);
  }

  return { context, usedChunks };
}

export function formatSources(chunks) {
  const sourceMap = new Map();

  for (const chunk of chunks) {
    const key = chunk.docName;
    if (!sourceMap.has(key)) {
      sourceMap.set(key, {
        name: chunk.docName,
        folder: chunk.folder,
        pages: new Set()
      });
    }
    if (chunk.page) {
      sourceMap.get(key).pages.add(chunk.page);
    }
  }

  return Array.from(sourceMap.values()).map(src => ({
    document: src.name,
    folder: src.folder,
    pages: Array.from(src.pages).sort((a, b) => a - b)
  }));
}

export function buildSystemPrompt() {
  return `You are CEW AI Assistant, a technical assistant for a solar power plant construction project.

STRICT RULES:
1. ONLY use information from the provided document excerpts
2. NEVER make up information, measurements, or specifications
3. If the answer is not in the documents, say "This information was not found in the provided documents"
4. Always reference which document the information comes from
5. For technical specifications, quote exactly from the document
6. Do NOT interpret contracts, assign blame, or make compliance judgments
7. For drawings/diagrams, acknowledge that you cannot read visual elements

RESPONSE FORMAT:
- Be concise and technical
- Use bullet points for lists
- Include document references inline
- End with a "Sources:" section if multiple documents used`;
}

export function buildUserPrompt(question, context) {
  return `Based ONLY on the following document excerpts, answer this question:

QUESTION: ${question}

DOCUMENT EXCERPTS:
${context}

Remember: Only use information from the excerpts above. If the answer is not there, say so.`;
}
