/**
 * Prompt Templates for LLM interactions
 * Based on AGENT_ROLES.md answer template requirements
 */

/**
 * System prompt for the CEW AI Assistant
 */
export const SYSTEM_PROMPT = `You are the CEW AI Assistant, a read-only intelligence layer for construction project documentation.

CRITICAL RULES:
1. NEVER guess or speculate. Only state facts from provided sources.
2. NEVER make compliance, approval, or handover decisions.
3. NEVER use phrases like "probably", "likely", "should be", "I think".
4. ALWAYS cite the source document and page/section.
5. If information is not in the sources, say "Not found in uploaded documents."
6. If values appear only in drawings (no text), say "Not available as text (OCR required)."
7. Use short, direct, engineering language.
8. If sources conflict, present both without choosing one.

RESPONSE FORMAT:
Answer: [Short, direct answer]

Source: [Document name, page/section] OR [CEW module, timestamp] OR "Not available"

LANGUAGE: Match the user's language (Turkish or English).`;

/**
 * Generate a query prompt with context
 * @param {Object} params
 * @param {string} params.question - User's question
 * @param {Array} params.chunks - Relevant document chunks
 * @param {string} params.routeType - DOC, CEW_DATA, HYBRID, or REFUSE
 * @returns {string}
 */
export function buildQueryPrompt({ question, chunks = [], routeType = "DOC" }) {
  let contextSection = "";

  if (chunks.length > 0) {
    contextSection = "RETRIEVED DOCUMENTS:\n\n";
    for (const chunk of chunks) {
      contextSection += `--- Source: ${chunk.docName}`;
      if (chunk.page) contextSection += `, Page ${chunk.page}`;
      if (chunk.sheetName) contextSection += `, Sheet: ${chunk.sheetName}`;
      if (chunk.sectionTitle) contextSection += `, Section: ${chunk.sectionTitle}`;
      contextSection += " ---\n";
      contextSection += chunk.text + "\n\n";

      // Add flags if present
      if (chunk.flags && chunk.flags.length > 0) {
        contextSection += `[Flags: ${chunk.flags.join(", ")}]\n\n`;
      }
    }
  } else {
    contextSection = "No relevant documents found for this query.\n";
  }

  const routeNote = getRouteNote(routeType);

  return `${contextSection}
${routeNote}

USER QUESTION: ${question}

Remember:
- Answer in short, direct engineering language
- Cite the source (document name + page/section)
- If not found, say "Not found in uploaded documents"
- Do not speculate or guess`;
}

/**
 * Get route-specific instruction note
 * @param {string} routeType
 * @returns {string}
 */
function getRouteNote(routeType) {
  switch (routeType) {
    case "DOC":
      return "ROUTE: Document Query - Answer from provided documents only.";
    case "CEW_DATA":
      return "ROUTE: CEW System Data - Present the metrics as provided, do not calculate or modify.";
    case "HYBRID":
      return "ROUTE: Hybrid Query - Combine document info with CEW metrics. Cite both sources.";
    case "REFUSE":
      return "ROUTE: Out of Scope - Politely decline or ask for clarification.";
    default:
      return "";
  }
}

/**
 * Build a prompt for question classification/routing
 * @param {string} question
 * @returns {string}
 */
export function buildRoutingPrompt(question) {
  return `Classify the following user question into one of these categories:

1. DOC - Question about project documents (specs, manuals, QAQC, BOM, drawings, legends)
   Examples: "Which connector is used?", "What torque wrench?", "What is the trench depth?"

2. CEW_DATA - Question about system metrics/progress data
   Examples: "Panel installation %?", "How many MC4 completed?", "Open NCRs?"

3. HYBRID - Needs both documents and system data
   Examples: "Are we meeting ITP frequency?", "Weekly panel average?"

4. REFUSE - Out of scope, compliance questions, or cannot answer
   Examples: "Is this compliant?", "Should we approve?", "Which design is better?"

USER QUESTION: ${question}

Respond with only one word: DOC, CEW_DATA, HYBRID, or REFUSE`;
}

/**
 * Format the final answer with source citation
 * @param {Object} params
 * @param {string} params.answer - The answer text
 * @param {Array} params.sources - Source chunks used
 * @param {Object} params.guardResult - Guard check results
 * @returns {string}
 */
export function formatAnswer({ answer, sources = [], guardResult = {} }) {
  let formattedAnswer = answer;

  // Add disclaimer if needed
  if (guardResult.requiresDisclaimer) {
    if (guardResult.disclaimerType === "ocr") {
      formattedAnswer +=
        "\n\n⚠️ Note: Some values may only be visible in drawings and not available as text.";
    } else if (guardResult.disclaimerType === "drawing") {
      formattedAnswer +=
        "\n\n⚠️ Note: Drawing content has limited support. Numeric values from images cannot be extracted.";
    }
  }

  // Add source section if not already included
  if (
    !formattedAnswer.toLowerCase().includes("source:") &&
    !formattedAnswer.toLowerCase().includes("kaynak:")
  ) {
    if (sources.length > 0) {
      formattedAnswer += "\n\nSource: ";
      const sourceRefs = sources.slice(0, 3).map((s) => {
        let ref = s.docName;
        if (s.page) ref += `, Page ${s.page}`;
        if (s.sheetName) ref += `, Sheet: ${s.sheetName}`;
        return ref;
      });
      formattedAnswer += sourceRefs.join("; ");
    } else {
      formattedAnswer += "\n\nSource: Not available";
    }
  }

  return formattedAnswer;
}

export default {
  SYSTEM_PROMPT,
  buildQueryPrompt,
  buildRoutingPrompt,
  formatAnswer,
};
