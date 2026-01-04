/**
 * Query Router - Routes questions to appropriate sources
 * Based on AGENT_ROLES.md Query Agent requirements
 */

import { chunkStore } from "../store/chunkStore.js";
import { keywordSearch } from "./keywordSearch.js";

/**
 * Route types
 */
export const ROUTE_TYPES = {
  DOC: "DOC", // Drive documents only
  CEW_DATA: "CEW_DATA", // CEW system data only
  HYBRID: "HYBRID", // Both docs and CEW data
  REFUSE: "REFUSE", // Out of scope / cannot answer
};

/**
 * Keyword patterns for routing classification
 */
const ROUTE_PATTERNS = {
  // CEW_DATA patterns (system metrics)
  CEW_DATA: [
    /(?:yüzde|percent|%)\s*(?:kaç|how much|complete|tamamlan)/i,
    /(?:kaç|how many)\s*(?:tane|adet|panel|mc4|checklist|ncr|punch)/i,
    /(?:installation|kurulum)\s*(?:progress|ilerleme)/i,
    /(?:open|açık)\s*(?:ncr|punch|issue)/i,
    /(?:completion|tamamlanma)\s*(?:rate|oran)/i,
    /(?:daily|weekly|günlük|haftalık)\s*(?:count|sayı|average|ortalama)/i,
  ],

  // DOC patterns (document queries)
  DOC: [
    /(?:hangi|which|what)\s*(?:connector|kablo|cable|wrench|tool|alet)/i,
    /(?:ne|what)\s*(?:anlam|mean|demek)/i,
    /(?:torque|tork)\s*(?:value|değer)/i,
    /(?:depth|derinlik|height|yükseklik|width|genişlik)/i,
    /(?:material|malzeme)\s*(?:type|tür|spec)/i,
    /(?:legend|lejant)\s*(?:açıklama|meaning)/i,
    /(?:spec|specification|şartname)/i,
    /(?:manual|kılavuz)/i,
    /(?:drawing|çizim)/i,
    /(?:bom|boq|bill of)/i,
  ],

  // REFUSE patterns (out of scope)
  REFUSE: [
    /(?:compliant|uyumlu)\s*(?:mu|is it)/i,
    /(?:approve|onayla|sign off|imzala)/i,
    /(?:safe|güvenli)\s*(?:for|için)\s*(?:handover|teslim)/i,
    /(?:which|hangi)\s*(?:design|tasarım)\s*(?:better|daha iyi)/i,
    /(?:should we|yapalım mı)/i,
    /(?:recommend|tavsiye|öner)/i,
  ],
};

/**
 * Folder mapping for document routing
 */
const FOLDER_KEYWORDS = {
  Manuals: ["manual", "kılavuz", "guide", "tool", "alet", "wrench", "torque"],
  Specifications: ["spec", "şartname", "requirement", "gereksinim"],
  QAQC: ["qaqc", "itp", "checklist", "inspection", "test"],
  BOM_BOQ: ["bom", "boq", "quantity", "miktar", "connector", "cable", "kablo"],
  Drawings: ["drawing", "çizim", "section", "kesit", "detail", "detay"],
  Legends: ["legend", "lejant", "symbol", "sembol", "mean", "anlam"],
};

/**
 * Classify a question into route type
 * @param {string} question
 * @returns {string} Route type
 */
export function classifyQuestion(question) {
  const q = question.toLowerCase();

  // Check REFUSE patterns first
  for (const pattern of ROUTE_PATTERNS.REFUSE) {
    if (pattern.test(q)) {
      return ROUTE_TYPES.REFUSE;
    }
  }

  // Check for CEW_DATA patterns
  let cewScore = 0;
  for (const pattern of ROUTE_PATTERNS.CEW_DATA) {
    if (pattern.test(q)) cewScore++;
  }

  // Check for DOC patterns
  let docScore = 0;
  for (const pattern of ROUTE_PATTERNS.DOC) {
    if (pattern.test(q)) docScore++;
  }

  // Determine route
  if (cewScore > 0 && docScore > 0) {
    return ROUTE_TYPES.HYBRID;
  } else if (cewScore > docScore) {
    return ROUTE_TYPES.CEW_DATA;
  } else {
    return ROUTE_TYPES.DOC; // Default to document query
  }
}

/**
 * Determine which folder to prioritize for a question
 * @param {string} question
 * @returns {string|null}
 */
export function detectTargetFolder(question) {
  const q = question.toLowerCase();

  for (const [folder, keywords] of Object.entries(FOLDER_KEYWORDS)) {
    for (const kw of keywords) {
      if (q.includes(kw)) {
        return folder;
      }
    }
  }

  return null;
}

/**
 * Route a question and retrieve relevant evidence
 * @param {Object} params
 * @param {string} params.question - User's question
 * @param {string} params.scope - Optional scope filter (folder name)
 * @param {number} params.maxResults - Maximum results to return
 * @returns {Object} Routing result with evidence
 */
export function routeQuery({ question, scope = null, maxResults = 10 }) {
  const routeType = classifyQuestion(question);

  // Build the result object
  const result = {
    question,
    routeType,
    scope,
    evidence: {
      docChunks: [],
      cewMetrics: null,
    },
    recommendation: null,
  };

  // Handle REFUSE route
  if (routeType === ROUTE_TYPES.REFUSE) {
    result.recommendation =
      "Bu soru kapsam dışı veya onay gerektiriyor. / This question is out of scope or requires approval.";
    return result;
  }

  // Handle DOC route
  if (routeType === ROUTE_TYPES.DOC || routeType === ROUTE_TYPES.HYBRID) {
    const targetFolder = scope || detectTargetFolder(question);

    // Get all chunks and search
    const allChunks = chunkStore.getAllChunks();

    if (allChunks.length > 0) {
      result.evidence.docChunks = keywordSearch(allChunks, question, {
        maxResults,
        folder: targetFolder,
      });
    }

    if (result.evidence.docChunks.length === 0) {
      // Try broader search without folder filter
      result.evidence.docChunks = keywordSearch(allChunks, question, {
        maxResults,
      });
    }
  }

  // Handle CEW_DATA route (placeholder for backend integration)
  if (routeType === ROUTE_TYPES.CEW_DATA || routeType === ROUTE_TYPES.HYBRID) {
    // MVP: CEW data integration will be added later
    result.evidence.cewMetrics = {
      available: false,
      note: "CEW backend integration pending (MVP)",
    };
  }

  // Add recommendation based on evidence
  if (
    result.evidence.docChunks.length === 0 &&
    !result.evidence.cewMetrics?.available
  ) {
    result.recommendation =
      "İlgili doküman bulunamadı. / No relevant documents found.";
  }

  return result;
}

/**
 * Search with folder-aware filtering
 * @param {Array} chunks
 * @param {string} question
 * @param {Object} options
 * @returns {Array}
 */
function searchWithFolderFilter(chunks, question, options = {}) {
  const { maxResults = 10, folder = null } = options;

  let candidates = chunks;

  // Filter by folder if specified
  if (folder) {
    const f = folder.toLowerCase();
    candidates = candidates.filter(
      (c) => c.folder && c.folder.toLowerCase().includes(f)
    );
  }

  return keywordSearch(candidates, question, { maxResults });
}

export default {
  ROUTE_TYPES,
  classifyQuestion,
  detectTargetFolder,
  routeQuery,
};
