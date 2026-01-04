/**
 * Guard Rules - Safety and accuracy checks for AI responses
 * Based on AGENT_ROLES.md Guard Agent requirements
 */

// Blocked phrases that indicate speculation
const SPECULATION_PHRASES = [
  "probably",
  "muhtemelen",
  "likely",
  "büyük ihtimalle",
  "should be",
  "olmalı",
  "I think",
  "sanırım",
  "I believe",
  "bence",
  "usually",
  "genellikle",
  "typically",
  "genelde",
  "in most cases",
  "çoğu durumda",
  "assume",
  "varsayıyorum",
  "guess",
  "tahmin",
];

// Compliance/approval phrases that must be refused
const COMPLIANCE_PHRASES = [
  "compliant",
  "uyumlu",
  "approved",
  "onaylanmış",
  "safe for handover",
  "teslime hazır",
  "meets requirements",
  "gereksinimleri karşılıyor",
  "certification",
  "sertifikasyon",
  "sign off",
  "imzala",
  "authorize",
  "yetkilendir",
];

/**
 * Check if response contains speculation language
 * @param {string} text
 * @returns {{ pass: boolean, flags: string[] }}
 */
export function checkNoSpeculation(text) {
  const lower = text.toLowerCase();
  const found = SPECULATION_PHRASES.filter((phrase) => lower.includes(phrase));

  return {
    pass: found.length === 0,
    flags: found.length > 0 ? ["SPECULATION_DETECTED"] : [],
    details: found,
  };
}

/**
 * Check if response makes compliance/approval claims
 * @param {string} text
 * @returns {{ pass: boolean, flags: string[] }}
 */
export function checkNoComplianceClaims(text) {
  const lower = text.toLowerCase();
  const found = COMPLIANCE_PHRASES.filter((phrase) => lower.includes(phrase));

  return {
    pass: found.length === 0,
    flags: found.length > 0 ? ["COMPLIANCE_CLAIM_DETECTED"] : [],
    details: found,
  };
}

/**
 * Check if answer has source citations
 * @param {string} answer
 * @param {Array} sources - Evidence chunks used
 * @returns {{ pass: boolean, flags: string[] }}
 */
export function checkSourcePresence(answer, sources) {
  const hasSource = sources && sources.length > 0;
  const mentionsSource =
    answer.toLowerCase().includes("source:") ||
    answer.toLowerCase().includes("kaynak:");

  return {
    pass: hasSource || mentionsSource,
    flags: !hasSource && !mentionsSource ? ["NO_SOURCE"] : [],
  };
}

/**
 * Check for OCR-required content flags
 * @param {Array} chunks - Retrieved chunks
 * @returns {{ pass: boolean, flags: string[], requiresDisclaimer: boolean }}
 */
export function checkOCRFlags(chunks) {
  const ocrChunks = chunks.filter(
    (c) => c.flags && c.flags.includes("OCR_REQUIRED")
  );
  const limitedChunks = chunks.filter(
    (c) => c.flags && c.flags.includes("LIMITED_SUPPORT_NO_OCR")
  );

  return {
    pass: true, // OCR flags don't block, but require disclaimer
    flags: ocrChunks.length > 0 ? ["OCR_REQUIRED"] : [],
    requiresDisclaimer: ocrChunks.length > 0 || limitedChunks.length > 0,
    disclaimerType:
      ocrChunks.length > 0 ? "ocr" : limitedChunks.length > 0 ? "drawing" : null,
  };
}

/**
 * Check for conflicting sources
 * @param {Array} chunks - Retrieved chunks
 * @param {string} topic - The topic being queried
 * @returns {{ pass: boolean, flags: string[], conflicts: Array }}
 */
export function checkConflictingSources(chunks, topic) {
  // MVP: Simple check - if multiple docs have very different values for same topic
  // This is a placeholder for more sophisticated conflict detection
  const docSources = new Set(chunks.map((c) => c.docName));

  return {
    pass: true,
    flags: docSources.size > 2 ? ["MULTIPLE_SOURCES"] : [],
    conflicts: [],
    recommendation:
      docSources.size > 2 ? "Multiple sources found - verify consistency" : null,
  };
}

/**
 * Run all guard checks on a response
 * @param {Object} params
 * @param {string} params.answer - The AI's draft answer
 * @param {Array} params.sources - Evidence chunks used
 * @param {string} params.question - Original user question
 * @returns {Object} Guard result
 */
export function runGuardChecks({ answer, sources = [], question = "" }) {
  const results = {
    speculation: checkNoSpeculation(answer),
    compliance: checkNoComplianceClaims(question + " " + answer),
    sourcePresence: checkSourcePresence(answer, sources),
    ocrFlags: checkOCRFlags(sources),
  };

  const allFlags = [
    ...results.speculation.flags,
    ...results.compliance.flags,
    ...results.sourcePresence.flags,
    ...results.ocrFlags.flags,
  ];

  const passed =
    results.speculation.pass &&
    results.compliance.pass &&
    results.sourcePresence.pass;

  return {
    passed,
    flags: allFlags,
    results,
    requiresDisclaimer: results.ocrFlags.requiresDisclaimer,
    disclaimerType: results.ocrFlags.disclaimerType,
  };
}

/**
 * Generate safe fallback response
 * @param {string} reason
 * @returns {string}
 */
export function getSafeFallback(reason = "not_found") {
  const fallbacks = {
    not_found:
      "Bu bilgi yüklenen dokümanlarda bulunamadı. / This information was not found in the uploaded documents.",
    ocr_required:
      "Bu değer çizimde görünüyor ancak metin olarak mevcut değil (OCR gerekli). / This value appears in the drawing but is not available as text (OCR required).",
    compliance_refused:
      "Uygunluk veya onay kararları veremem. Lütfen yetkili mühendise danışın. / I cannot make compliance or approval decisions. Please consult the authorized engineer.",
    speculation_blocked:
      "Bu soruya kesin kaynak olmadan cevap veremem. / I cannot answer this question without a definitive source.",
    out_of_scope:
      "Bu soru mevcut doküman kapsamının dışında. / This question is outside the scope of available documents.",
  };

  return fallbacks[reason] || fallbacks.not_found;
}

export default {
  runGuardChecks,
  checkNoSpeculation,
  checkNoComplianceClaims,
  checkSourcePresence,
  checkOCRFlags,
  checkConflictingSources,
  getSafeFallback,
};
