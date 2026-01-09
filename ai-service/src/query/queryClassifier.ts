/**
 * Query Classifier Module
 * @module query/queryClassifier
 * 
 * Deterministic, rule-based query classification.
 * Classifies queries into document, data, or hybrid types
 * without using LLM inference.
 */

import { QueryType } from '../types';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of query classification
 */
export interface QueryClassification {
  /**
   * Classification type
   * - 'document': Query about specifications, procedures, standards
   * - 'data': Query about quantities, progress, dates
   * - 'hybrid': Query requiring both document and data sources
   */
  type: QueryType;

  /**
   * Classification confidence (0-1)
   * - 1.0 for clear document or data queries
   * - < 1.0 for hybrid or uncertain classifications
   */
  confidence: number;

  /**
   * Extracted keywords for retrieval enhancement
   */
  keywords: string[];

  /**
   * Detected query intent
   */
  intent: string;

  /**
   * Whether data fetching should be attempted (MVP: false for data/hybrid)
   */
  shouldFetchData: boolean;

  /**
   * Whether document retrieval should be attempted
   */
  shouldRetrieveDocuments: boolean;

  /**
   * Detected language of the query
   */
  language: 'tr' | 'en';
}

/**
 * Keyword match result
 */
interface KeywordMatch {
  keyword: string;
  category: 'document' | 'data';
  weight: number;
}

// ============================================================================
// Keyword Definitions
// ============================================================================

/**
 * Document-related keywords (specs, procedures, standards)
 */
const DOCUMENT_KEYWORDS = {
  tr: [
    // Question words
    { keyword: 'nedir', weight: 1.0 },
    { keyword: 'ne demek', weight: 1.0 },
    { keyword: 'nasıl yapılır', weight: 0.9 },
    { keyword: 'nasıl', weight: 0.7 },
    // Procedure/Process
    { keyword: 'prosedür', weight: 1.0 },
    { keyword: 'prosedürü', weight: 1.0 },
    { keyword: 'işlem', weight: 0.8 },
    { keyword: 'adımlar', weight: 0.9 },
    { keyword: 'süreç', weight: 0.8 },
    // Standards
    { keyword: 'standart', weight: 1.0 },
    { keyword: 'standardı', weight: 1.0 },
    { keyword: 'standartta', weight: 1.0 },
    { keyword: 'şartname', weight: 1.0 },
    { keyword: 'şartnamesi', weight: 1.0 },
    { keyword: 'spesifikasyon', weight: 1.0 },
    { keyword: 'teknik', weight: 0.7 },
    // Acceptance/Approval
    { keyword: 'kabul', weight: 0.9 },
    { keyword: 'kabul kriterleri', weight: 1.0 },
    { keyword: 'onay', weight: 0.8 },
    // Documentation
    { keyword: 'doküman', weight: 0.9 },
    { keyword: 'belge', weight: 0.8 },
    { keyword: 'talimat', weight: 0.9 },
    { keyword: 'kılavuz', weight: 0.9 },
    // Requirements
    { keyword: 'gereksinim', weight: 0.9 },
    { keyword: 'şart', weight: 0.8 },
    { keyword: 'kural', weight: 0.8 },
    // QAQC
    { keyword: 'qaqc', weight: 1.0 },
    { keyword: 'kalite', weight: 0.8 },
    { keyword: 'kontrol', weight: 0.7 },
    { keyword: 'denetim', weight: 0.8 },
    { keyword: 'test', weight: 0.7 },
  ],
  en: [
    // Question words
    { keyword: 'what is', weight: 1.0 },
    { keyword: 'what are', weight: 1.0 },
    { keyword: 'how to', weight: 0.9 },
    { keyword: 'how do', weight: 0.8 },
    { keyword: 'explain', weight: 0.8 },
    { keyword: 'describe', weight: 0.8 },
    // Procedure/Process
    { keyword: 'procedure', weight: 1.0 },
    { keyword: 'process', weight: 0.8 },
    { keyword: 'steps', weight: 0.9 },
    { keyword: 'method', weight: 0.8 },
    { keyword: 'workflow', weight: 0.9 },
    // Standards
    { keyword: 'standard', weight: 1.0 },
    { keyword: 'specification', weight: 1.0 },
    { keyword: 'spec', weight: 1.0 },
    { keyword: 'according to', weight: 0.9 },
    { keyword: 'requirements', weight: 0.9 },
    { keyword: 'compliance', weight: 0.9 },
    // Acceptance
    { keyword: 'acceptance', weight: 0.9 },
    { keyword: 'criteria', weight: 0.8 },
    { keyword: 'approval', weight: 0.8 },
    // Documentation
    { keyword: 'document', weight: 0.8 },
    { keyword: 'manual', weight: 0.9 },
    { keyword: 'guide', weight: 0.8 },
    { keyword: 'instruction', weight: 0.9 },
    // QAQC
    { keyword: 'qaqc', weight: 1.0 },
    { keyword: 'quality', weight: 0.8 },
    { keyword: 'inspection', weight: 0.8 },
    { keyword: 'checklist', weight: 0.9 },
    { keyword: 'test', weight: 0.7 },
  ],
};

/**
 * Data-related keywords (quantities, progress, dates)
 */
const DATA_KEYWORDS = {
  tr: [
    // Quantity
    { keyword: 'kaç', weight: 1.0 },
    { keyword: 'kaç tane', weight: 1.0 },
    { keyword: 'kaç adet', weight: 1.0 },
    { keyword: 'ne kadar', weight: 0.9 },
    { keyword: 'miktar', weight: 0.9 },
    { keyword: 'adet', weight: 0.8 },
    { keyword: 'sayı', weight: 0.8 },
    // Units
    { keyword: 'metre', weight: 0.9 },
    { keyword: 'metrekare', weight: 0.9 },
    { keyword: 'ton', weight: 0.9 },
    { keyword: 'kg', weight: 0.8 },
    { keyword: 'kw', weight: 0.8 },
    { keyword: 'mw', weight: 0.8 },
    // Time
    { keyword: 'bugün', weight: 1.0 },
    { keyword: 'dün', weight: 1.0 },
    { keyword: 'bu hafta', weight: 1.0 },
    { keyword: 'bu ay', weight: 1.0 },
    { keyword: 'tarih', weight: 0.8 },
    { keyword: 'ne zaman', weight: 0.9 },
    // Progress
    { keyword: 'toplam', weight: 0.9 },
    { keyword: 'ilerleme', weight: 1.0 },
    { keyword: 'progress', weight: 1.0 },
    { keyword: 'durum', weight: 0.8 },
    { keyword: 'tamamlanan', weight: 0.9 },
    { keyword: 'kalan', weight: 0.9 },
    { keyword: 'yüzde', weight: 0.9 },
    { keyword: '%', weight: 0.8 },
    // Statistics
    { keyword: 'istatistik', weight: 0.9 },
    { keyword: 'rapor', weight: 0.8 },
    { keyword: 'özet', weight: 0.8 },
  ],
  en: [
    // Quantity
    { keyword: 'how many', weight: 1.0 },
    { keyword: 'how much', weight: 1.0 },
    { keyword: 'count', weight: 0.9 },
    { keyword: 'number of', weight: 0.9 },
    { keyword: 'quantity', weight: 0.9 },
    { keyword: 'amount', weight: 0.8 },
    // Units
    { keyword: 'meter', weight: 0.9 },
    { keyword: 'meters', weight: 0.9 },
    { keyword: 'square meter', weight: 0.9 },
    { keyword: 'ton', weight: 0.9 },
    { keyword: 'kg', weight: 0.8 },
    { keyword: 'kw', weight: 0.8 },
    { keyword: 'mw', weight: 0.8 },
    // Time
    { keyword: 'today', weight: 1.0 },
    { keyword: 'yesterday', weight: 1.0 },
    { keyword: 'this week', weight: 1.0 },
    { keyword: 'this month', weight: 1.0 },
    { keyword: 'date', weight: 0.8 },
    { keyword: 'when', weight: 0.7 },
    // Progress
    { keyword: 'total', weight: 0.9 },
    { keyword: 'progress', weight: 1.0 },
    { keyword: 'status', weight: 0.8 },
    { keyword: 'completed', weight: 0.9 },
    { keyword: 'remaining', weight: 0.9 },
    { keyword: 'percentage', weight: 0.9 },
    { keyword: 'percent', weight: 0.9 },
    { keyword: '%', weight: 0.8 },
    // Statistics
    { keyword: 'statistics', weight: 0.9 },
    { keyword: 'report', weight: 0.8 },
    { keyword: 'summary', weight: 0.8 },
    { keyword: 'dashboard', weight: 0.9 },
  ],
};

/**
 * Intent patterns for more specific classification
 */
const INTENT_PATTERNS = {
  // Document intents
  definition: /\b(nedir|ne demek|what is|what are|define)\b/i,
  procedure: /\b(nasıl|prosedür|how to|procedure|steps|adım)\b/i,
  specification: /\b(şartname|spesifikasyon|spec|standard|standart)\b/i,
  requirements: /\b(gereksinim|kriter|requirement|criteria|kabul)\b/i,
  
  // Data intents - production snapshot queries
  quantity: /\b(kaç|how many|how much|ne kadar|miktar|count)\b/i,
  progress: /\b(ilerleme|progress|durum|status|tamamlan|complet)\b/i,
  timeline: /\b(bugün|today|tarih|date|ne zaman|when|deadline)\b/i,
  statistics: /\b(toplam|total|yüzde|percent|istatistik|statistic)\b/i,
  remaining: /\b(kalan|remaining|geriye|left|eksik)\b/i,
  production_snapshot: /\b(takıldı|takılan|çekildi|çekilen|installed|pulled|yapıldı|yapılan|tamamlandı|completed)\b/i,
};

// ============================================================================
// Main Classification Function
// ============================================================================

/**
 * Classify a user query into document, data, or hybrid type
 * 
 * Uses deterministic keyword matching - no LLM inference.
 * 
 * Classification rules:
 * - DOCUMENT: Queries about specifications, procedures, standards, definitions
 * - DATA: Queries about quantities, progress, dates, statistics
 * - HYBRID: Queries containing both document and data intent
 * 
 * @param query - User query string
 * @returns Classification result with type, confidence, keywords, and intent
 * 
 * @example
 * ```typescript
 * // Document query
 * classifyQuery('What is the acceptance criteria for DC cables?')
 * // { type: 'document', confidence: 1.0, keywords: ['acceptance', 'criteria'], intent: 'requirements' }
 * 
 * // Data query
 * classifyQuery('How many panels were installed today?')
 * // { type: 'data', confidence: 1.0, keywords: ['how many', 'today'], intent: 'quantity', shouldFetchData: false }
 * 
 * // Hybrid query
 * classifyQuery('What is the progress on DC cable installation according to specs?')
 * // { type: 'hybrid', confidence: 0.85, keywords: ['progress', 'specs'], intent: 'progress+specification' }
 * ```
 */
export function classifyQuery(query: string): QueryClassification {
  const normalizedQuery = query.toLowerCase().trim();
  
  // Detect language
  const language = detectQueryLanguage(normalizedQuery);
  
  // Find keyword matches
  const matches = findKeywordMatches(normalizedQuery, language);
  
  // Calculate scores
  const documentScore = calculateCategoryScore(matches, 'document');
  const dataScore = calculateCategoryScore(matches, 'data');
  
  // Extract matched keywords
  const keywords = matches.map(m => m.keyword);
  
  // Detect intent
  const intent = detectIntent(normalizedQuery, documentScore, dataScore);
  
  // Classify based on scores
  const classification = determineClassification(
    documentScore,
    dataScore,
    intent,
    keywords,
    language
  );

  logger.debug('Query classified', {
    query: query.substring(0, 100),
    type: classification.type,
    confidence: classification.confidence,
    intent: classification.intent,
    keywords: classification.keywords,
    documentScore,
    dataScore,
  });

  return classification;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Detect query language based on Turkish characters and word patterns
 */
function detectQueryLanguage(query: string): 'tr' | 'en' {
  const turkishChars = /[ğĞüÜşŞıİöÖçÇ]/;
  
  if (turkishChars.test(query)) {
    return 'tr';
  }
  
  // Check for common Turkish words
  const turkishWords = ['ve', 'bir', 'bu', 'için', 'ile', 'ne', 'kaç', 'nasıl'];
  const words = query.split(/\s+/);
  const turkishWordCount = words.filter(w => turkishWords.includes(w)).length;
  
  if (turkishWordCount >= 2) {
    return 'tr';
  }
  
  return 'en';
}

/**
 * Find all keyword matches in the query
 */
function findKeywordMatches(query: string, language: 'tr' | 'en'): KeywordMatch[] {
  const matches: KeywordMatch[] = [];
  
  // Check document keywords
  const docKeywords = DOCUMENT_KEYWORDS[language];
  for (const { keyword, weight } of docKeywords) {
    if (query.includes(keyword)) {
      matches.push({ keyword, category: 'document', weight });
    }
  }
  
  // Check data keywords
  const dataKeywords = DATA_KEYWORDS[language];
  for (const { keyword, weight } of dataKeywords) {
    if (query.includes(keyword)) {
      matches.push({ keyword, category: 'data', weight });
    }
  }
  
  // Also check the other language for common terms
  const otherLang = language === 'tr' ? 'en' : 'tr';
  
  for (const { keyword, weight } of DOCUMENT_KEYWORDS[otherLang]) {
    if (query.includes(keyword) && !matches.some(m => m.keyword === keyword)) {
      matches.push({ keyword, category: 'document', weight: weight * 0.8 });
    }
  }
  
  for (const { keyword, weight } of DATA_KEYWORDS[otherLang]) {
    if (query.includes(keyword) && !matches.some(m => m.keyword === keyword)) {
      matches.push({ keyword, category: 'data', weight: weight * 0.8 });
    }
  }
  
  return matches;
}

/**
 * Calculate weighted score for a category
 */
function calculateCategoryScore(matches: KeywordMatch[], category: 'document' | 'data'): number {
  const categoryMatches = matches.filter(m => m.category === category);
  
  if (categoryMatches.length === 0) {
    return 0;
  }
  
  // Sum of weights, capped at 2.0
  const totalWeight = categoryMatches.reduce((sum, m) => sum + m.weight, 0);
  return Math.min(totalWeight, 2.0);
}

/**
 * Detect the primary intent of the query
 */
function detectIntent(query: string, docScore: number, dataScore: number): string {
  const intents: string[] = [];
  
  // Check document intents
  if (INTENT_PATTERNS.definition.test(query)) {
    intents.push('definition');
  }
  if (INTENT_PATTERNS.procedure.test(query)) {
    intents.push('procedure');
  }
  if (INTENT_PATTERNS.specification.test(query)) {
    intents.push('specification');
  }
  if (INTENT_PATTERNS.requirements.test(query)) {
    intents.push('requirements');
  }
  
  // Check data intents
  if (INTENT_PATTERNS.quantity.test(query)) {
    intents.push('quantity');
  }
  if (INTENT_PATTERNS.progress.test(query)) {
    intents.push('progress');
  }
  if (INTENT_PATTERNS.timeline.test(query)) {
    intents.push('timeline');
  }
  if (INTENT_PATTERNS.statistics.test(query)) {
    intents.push('statistics');
  }
  if (INTENT_PATTERNS.remaining.test(query)) {
    intents.push('remaining');
  }
  if (INTENT_PATTERNS.production_snapshot.test(query)) {
    intents.push('production_snapshot');
  }
  
  if (intents.length === 0) {
    // Default based on scores
    if (docScore > dataScore) {
      return 'general_document';
    } else if (dataScore > docScore) {
      return 'general_data';
    }
    return 'general';
  }
  
  return intents.join('+');
}

/**
 * Determine final classification based on scores
 */
function determineClassification(
  docScore: number,
  dataScore: number,
  intent: string,
  keywords: string[],
  language: 'tr' | 'en'
): QueryClassification {
  // Calculate confidence and type
  let type: QueryType;
  let confidence: number;
  let shouldFetchData: boolean;
  let shouldRetrieveDocuments: boolean;

  const totalScore = docScore + dataScore;
  
  if (totalScore === 0) {
    // No keywords matched - default to document query
    type = 'document';
    confidence = 0.5;
    shouldFetchData = false;
    shouldRetrieveDocuments = true;
  } else if (docScore > 0 && dataScore > 0) {
    // Both types detected - hybrid
    type = 'hybrid';
    // Confidence is lower for hybrid queries
    confidence = Math.min(0.85, (totalScore / 4) * 0.85);
    // MVP: Don't fetch data for hybrid queries
    shouldFetchData = false;
    shouldRetrieveDocuments = true;
  } else if (dataScore > docScore) {
    // Data query - use production snapshots
    type = 'data';
    confidence = Math.min(1.0, dataScore / 1.5);
    // Enable snapshot-based data fetch
    shouldFetchData = true;
    shouldRetrieveDocuments = false;
  } else {
    // Document query
    type = 'document';
    confidence = Math.min(1.0, docScore / 1.5);
    shouldFetchData = false;
    shouldRetrieveDocuments = true;
  }

  // Ensure minimum confidence
  confidence = Math.max(0.3, confidence);
  // Round to 2 decimal places
  confidence = Math.round(confidence * 100) / 100;

  return {
    type,
    confidence,
    keywords: [...new Set(keywords)], // Deduplicate
    intent,
    shouldFetchData,
    shouldRetrieveDocuments,
    language,
  };
}

// ============================================================================
// Additional Utility Functions
// ============================================================================

/**
 * Extract search keywords from a query for retrieval enhancement
 * 
 * Removes stop words and extracts meaningful terms.
 * 
 * @param query - User query
 * @param language - Detected language
 * @returns Array of keywords for search
 */
export function extractSearchKeywords(query: string, language: 'tr' | 'en'): string[] {
  const stopWords = {
    tr: new Set(['ve', 'veya', 'bir', 'bu', 'şu', 'o', 'de', 'da', 'mi', 'mı', 'mu', 'mü', 'ile', 'için']),
    en: new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how', 'what', 'which', 'who', 'this', 'that', 'these', 'those', 'it', 'its', 'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as']),
  };

  const words = query
    .toLowerCase()
    .replace(/[^\w\sğüşıöçĞÜŞİÖÇ]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 2)
    .filter(word => !stopWords[language].has(word));

  // Deduplicate and return
  return [...new Set(words)];
}

/**
 * Check if query requires document retrieval based on classification
 * 
 * @param classification - Query classification result
 * @returns Whether documents should be retrieved
 */
export function requiresDocumentRetrieval(classification: QueryClassification): boolean {
  return classification.shouldRetrieveDocuments;
}

/**
 * Check if query requires data fetching (MVP: always false)
 * 
 * @param classification - Query classification result
 * @returns Whether data should be fetched
 */
export function requiresDataFetch(classification: QueryClassification): boolean {
  // MVP: Data fetching not implemented
  return classification.shouldFetchData;
}

/**
 * Get a human-readable description of the classification
 * 
 * @param classification - Query classification result
 * @returns Description string
 */
export function getClassificationDescription(classification: QueryClassification): string {
  const typeDescriptions = {
    document: 'Document/specification query',
    data: 'Data/progress query (data fetch not available in MVP)',
    hybrid: 'Hybrid query requiring both documents and data',
  };

  return `${typeDescriptions[classification.type]} - Intent: ${classification.intent} (${Math.round(classification.confidence * 100)}% confidence)`;
}

// ============================================================================
// Exports
// ============================================================================

export default {
  classifyQuery,
  extractSearchKeywords,
  requiresDocumentRetrieval,
  requiresDataFetch,
  getClassificationDescription,
};
