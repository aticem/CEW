/**
 * Policy Service Module
 * @module services/policyService
 * 
 * Handles input validation, language detection, content moderation,
 * and policy enforcement for the CEW AI Service.
 */

import { logger } from './loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported languages
 */
export type SupportedLanguage = 'tr' | 'en';

/**
 * Language detection result
 */
export type DetectedLanguage = SupportedLanguage | 'unknown';

/**
 * Result of input validation
 */
export interface ValidationResult {
  /** Whether the input is valid */
  valid: boolean;
  /** Detected language */
  language: SupportedLanguage;
  /** Sanitized input text */
  sanitized: string;
  /** Rejection message if invalid */
  rejection?: string;
}

/**
 * Policy configuration
 */
export interface PolicyConfig {
  /** Enable content moderation */
  enableContentModeration: boolean;
  /** Maximum query length in characters */
  maxQueryLength: number;
  /** Maximum response length in characters */
  maxResponseLength: number;
  /** Minimum query length in characters */
  minQueryLength: number;
  /** Allowed document types for ingestion */
  allowedDocumentTypes: string[];
  /** Terms to block (case-insensitive) */
  blockedTerms: string[];
}

/**
 * Result of policy check
 */
export interface PolicyCheckResult {
  /** Whether the check passed */
  allowed: boolean;
  /** Reason if not allowed */
  reason?: string;
  /** List of violations */
  violations: PolicyViolation[];
}

/**
 * Policy violation details
 */
export interface PolicyViolation {
  /** Type of violation */
  type: 'content' | 'length' | 'format' | 'access' | 'language' | 'spam';
  /** Description of violation */
  message: string;
  /** Severity level */
  severity: 'low' | 'medium' | 'high';
}

/**
 * Rejection messages by language
 */
export interface RejectionMessages {
  generic: { tr: string; en: string };
  languageNotSupported: { tr: string; en: string };
  tooShort: { tr: string; en: string };
  tooLong: { tr: string; en: string };
  spam: { tr: string; en: string };
  profanity: { tr: string; en: string };
}

// ============================================================================
// Constants
// ============================================================================

/** Default policy configuration */
const DEFAULT_CONFIG: PolicyConfig = {
  enableContentModeration: true,
  maxQueryLength: 2000,
  maxResponseLength: 50000,
  minQueryLength: 3,
  allowedDocumentTypes: ['pdf', 'docx', 'xlsx', 'txt', 'csv'],
  blockedTerms: [],
};

/** Turkish-specific characters for language detection */
const TURKISH_CHARS = /[ğĞüÜşŞıİöÖçÇ]/;

/**
 * High-priority Turkish keywords for question/query detection
 * These are weighted more heavily in language scoring
 * 
 * IMPORTANT: Only include words that are UNIQUE to Turkish language.
 * Do NOT include technical terms that could appear in both languages.
 */
const TURKISH_KEYWORDS = new Set([
  // Question words - these are strong Turkish indicators
  'nedir', 'nelerdir', 'nasil', 'nasıl', 'kac', 'kaç', 'hangi', 'neden', 'nerede', 'kim',
  'ne', 'neyi', 'neyin', 'neyle',
  // Turkish-specific technical question phrases
  'gore', 'göre', 'kabul', 'sart', 'şart', 'prosedur', 'prosedür',
  // Common Turkish question suffixes (strong indicators when standalone)
  'mi', 'mı', 'mu', 'mü', 'midir', 'mıdır', 'mudur', 'müdür',
  // Turkish verbs/words that don't exist in English
  'edilir', 'yapilir', 'yapılır', 'olmali', 'olmalı', 'gerekir', 'lazim', 'lazım',
]);

/**
 * High-priority English keywords for question/query detection
 * These are weighted more heavily in language scoring
 * 
 * IMPORTANT: Only include words that are UNIQUE to English language.
 * Do NOT include technical terms that could appear in both languages.
 */
const ENGLISH_KEYWORDS = new Set([
  // Question words - these are strong English indicators
  'what', 'how', 'why', 'when', 'where', 'which', 'who', 'whom', 'whose',
  // English-specific query words
  'many', 'much', 'according', 'about', 'does', 'should', 'would', 'could',
  // English prepositions/articles that don't exist in Turkish
  'the', 'are', 'there', 'these', 'those', 'been', 'being',
]);

/** Common Turkish words for frequency-based detection (1 point each) */
const TURKISH_WORDS = new Set([
  // Conjunctions and prepositions
  've', 'bir', 'bu', 'için', 'icin', 'ile', 'de', 'da', 'ne', 'var', 'olan',
  'gibi', 'daha', 'cok', 'çok', 'en', 'ben', 'sen', 'biz', 'siz', 'onlar',
  'kadar', 'sonra', 'once', 'önce', 'ama', 'ancak', 'fakat',
  'veya', 'ya', 'hem', 'ki', 'ise', 'degil', 'değil',
  // Verbs
  'olarak', 'oldu', 'olur', 'olacak', 'edildi', 'yapilir', 'yapılır',
  // Greetings and common phrases
  'merhaba', 'selam', 'nasilsin', 'nasılsın', 'iyiyim', 'tesekkur', 'teşekkür',
  'lutfen', 'lütfen', 'evet', 'hayir', 'hayır', 'tamam', 'peki',
  // Question-related
  'nedir', 'nelerdir', 'kac', 'kaç', 'gore', 'göre', 'acaba',
  // Possessive/demonstrative
  'bu', 'su', 'şu', 'bunlar', 'sunlar', 'şunlar', 'benim', 'senin', 'onun',
]);

/** Common English words for frequency-based detection (1 point each) */
const ENGLISH_WORDS = new Set([
  // Articles and common words
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  // Conjunctions and prepositions
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why',
  'how', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
  'those', 'it', 'its', 'of', 'to', 'in', 'for', 'on', 'with', 'at',
  'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
  // Common query words
  'many', 'according', 'procedure', 'standard', 'requirements',
  // Greetings
  'hello', 'hi', 'hey', 'thanks', 'thank', 'please', 'yes', 'no', 'okay',
  // Demonstratives
  'here', 'there', 'now', 'also', 'just', 'only', 'very', 'more', 'some',
]);

/** Spam patterns (regex) */
const SPAM_PATTERNS = [
  /(.)\1{5,}/i,                    // Repeated characters (6+)
  /\b(buy|sell|free|winner|prize|click|subscribe)\b/gi, // Spam keywords
  /(https?:\/\/[^\s]+){3,}/gi,     // Multiple URLs
  /[A-Z]{10,}/,                    // Long uppercase sequences
  /\$\d+[,.\d]*\s*(off|free)/gi,   // Price spam
];

/** Generic profanity patterns (very light, catches obvious cases) */
const PROFANITY_PATTERNS = [
  /\b(fuck|shit|damn|bitch|ass|bastard)\b/gi,      // English
  /\b(sik|bok|orospu|piç|amk|aq)\b/gi,             // Turkish
];

/** Rejection messages */
const REJECTION_MESSAGES: RejectionMessages = {
  generic: {
    tr: 'Bu giriş işlenemez.',
    en: 'This input cannot be processed.',
  },
  languageNotSupported: {
    tr: 'Sadece Türkçe ve İngilizce desteklenir.',
    en: 'Only Turkish and English are supported.',
  },
  tooShort: {
    tr: 'Giriş çok kısa. Lütfen en az 3 karakter girin.',
    en: 'Input too short. Please enter at least 3 characters.',
  },
  tooLong: {
    tr: 'Giriş çok uzun. Maksimum 2000 karakter desteklenir.',
    en: 'Input too long. Maximum 2000 characters supported.',
  },
  spam: {
    tr: 'Bu giriş spam olarak algılandı.',
    en: 'This input was detected as spam.',
  },
  profanity: {
    tr: 'Bu giriş uygunsuz içerik barındırıyor.',
    en: 'This input contains inappropriate content.',
  },
};

// ============================================================================
// Language Detection
// ============================================================================

/**
 * Normalize text for language detection
 * 
 * Operations:
 * - Convert to lowercase
 * - Remove punctuation
 * - Trim whitespace
 * - Normalize Turkish characters (optional ASCII equivalents)
 * 
 * @param text - Raw input text
 * @returns Normalized text for analysis
 */
function normalizeForDetection(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Remove punctuation but keep Turkish chars
    .replace(/[.,!?;:'"()\[\]{}\/\\<>@#$%^&*+=~`|]/g, ' ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract words from text for analysis
 * 
 * @param text - Normalized text
 * @returns Array of words (length >= 2)
 */
function extractWords(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(word => word.length >= 2);
}

/**
 * Detect the language of the input text
 * 
 * Detection strategy (in order of priority):
 * 1. Check for Turkish-specific characters (ğ, ü, ş, ı, ö, ç) - immediate Turkish
 * 2. Check for high-priority language keywords (weighted x3)
 * 3. Check for common language words (weighted x1)
 * 4. Compare scores: TR > EN → Turkish, EN > TR → English
 * 5. If both zero → 'unknown'
 * 
 * Scoring logic:
 * - Keywords (nedir, what, etc.) = 3 points each
 * - Common words (ve, the, etc.) = 1 point each
 * - If TR score > EN score → 'tr'
 * - If EN score > TR score → 'en'
 * - If tied or both zero → 'unknown' (unless heuristics apply)
 * 
 * @param text - Input text to analyze
 * @returns Detected language: 'tr', 'en', or 'unknown'
 * 
 * @example
 * ```typescript
 * detectLanguage('MC4 connector nedir?') // 'tr' (keyword: nedir)
 * detectLanguage('Merhaba dünya')        // 'tr' (Turkish char: ü)
 * detectLanguage('What is the ITP?')     // 'en' (keyword: what)
 * detectLanguage('Hello world')          // 'en' (common words)
 * detectLanguage('12345')                // 'unknown'
 * ```
 */
export function detectLanguage(text: string): DetectedLanguage {
  // Guard: empty input
  if (!text || text.trim().length === 0) {
    return 'unknown';
  }

  // Normalize input for consistent analysis
  const normalizedText = normalizeForDetection(text);

  // =========================================================================
  // Strategy 1: Turkish-specific characters (highest confidence)
  // If any Turkish chars present, it's definitely Turkish
  // =========================================================================
  if (TURKISH_CHARS.test(text)) {
    logger.debug('Language detected via Turkish characters', { 
      language: 'tr',
      input: text.substring(0, 50)
    });
    return 'tr';
  }

  // =========================================================================
  // Strategy 2 & 3: Keyword and word scoring
  // Keywords are weighted 3x because they're strong indicators
  // =========================================================================
  const words = extractWords(normalizedText);

  if (words.length === 0) {
    return 'unknown';
  }

  let turkishScore = 0;
  let englishScore = 0;

  // Score each word
  for (const word of words) {
    // High-priority keywords (3 points)
    if (TURKISH_KEYWORDS.has(word)) {
      turkishScore += 3;
      logger.debug('Turkish keyword match', { word, score: 3 });
    }
    if (ENGLISH_KEYWORDS.has(word)) {
      englishScore += 3;
      logger.debug('English keyword match', { word, score: 3 });
    }
    
    // Common words (1 point) - only if not already a keyword
    if (!TURKISH_KEYWORDS.has(word) && TURKISH_WORDS.has(word)) {
      turkishScore += 1;
    }
    if (!ENGLISH_KEYWORDS.has(word) && ENGLISH_WORDS.has(word)) {
      englishScore += 1;
    }
  }

  // =========================================================================
  // Strategy 4: Compare scores
  // =========================================================================
  logger.debug('Language score comparison', { 
    turkishScore, 
    englishScore,
    words: words.join(' ')
  });

  // Turkish wins if higher score
  if (turkishScore > englishScore) {
    logger.debug('Language detected via scoring', { 
      language: 'tr', 
      turkishScore, 
      englishScore 
    });
    return 'tr';
  }
  
  // English wins if higher score
  if (englishScore > turkishScore) {
    logger.debug('Language detected via scoring', { 
      language: 'en', 
      turkishScore, 
      englishScore 
    });
    return 'en';
  }

  // =========================================================================
  // Strategy 5: Tie-breaker heuristics
  // =========================================================================
  
  // Both scores are zero - try vowel ratio heuristic
  if (turkishScore === 0 && englishScore === 0) {
    // Turkish has high vowel density - check ratio
    const vowelMatches = normalizedText.match(/[aeiou]/gi) || [];
    const vowelRatio = vowelMatches.length / normalizedText.replace(/\s/g, '').length;
    
    // High vowel ratio with no English matches suggests Turkish
    if (vowelRatio > 0.45) {
      logger.debug('Language detected via vowel ratio heuristic', { 
        language: 'tr', 
        vowelRatio 
      });
      return 'tr';
    }
    
    // No clear signal
    logger.debug('Language unknown - no matches', { input: text.substring(0, 50) });
    return 'unknown';
  }

  // Scores are tied (but non-zero) - default to English for international queries
  logger.debug('Language tie, defaulting to English', { 
    turkishScore, 
    englishScore 
  });
  return 'en';
}

// ============================================================================
// Input Sanitization
// ============================================================================

/**
 * Sanitize user input text
 * 
 * Operations performed:
 * - Trim whitespace
 * - Normalize Unicode (NFC normalization)
 * - Remove excessive punctuation
 * - Remove HTML tags
 * - Collapse multiple spaces
 * 
 * @param text - Raw input text
 * @returns Sanitized text
 * 
 * @example
 * ```typescript
 * sanitizeInput('  Hello!!!!!!  World  ')  // 'Hello!!! World'
 * sanitizeInput('<script>alert(1)</script>') // 'alert(1)'
 * ```
 */
export function sanitizeInput(text: string): string {
  if (!text) {
    return '';
  }

  let sanitized = text;

  // Trim whitespace
  sanitized = sanitized.trim();

  // Normalize Unicode (NFC form)
  sanitized = sanitized.normalize('NFC');

  // Remove HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript:/gi, '');

  // Remove excessive punctuation (more than 3 of same)
  sanitized = sanitized.replace(/([!?.,;:])\1{3,}/g, '$1$1$1');

  // Collapse multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Remove control characters (except newlines and tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Trim again after all operations
  sanitized = sanitized.trim();

  return sanitized;
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate user input text
 * 
 * Validation checks:
 * - Not empty
 * - Minimum 3 characters
 * - Maximum 2000 characters
 * - Language must be Turkish or English
 * - No spam patterns
 * - No profanity
 * 
 * @param text - Input text to validate
 * @returns Validation result with sanitized text and any rejection message
 * 
 * @example
 * ```typescript
 * const result = validateInput('What is the installation process?');
 * // { valid: true, language: 'en', sanitized: 'What is the installation process?' }
 * 
 * const invalid = validateInput('ab');
 * // { valid: false, language: 'en', sanitized: 'ab', rejection: 'Input too short...' }
 * ```
 */
export function validateInput(text: string): ValidationResult {
  // Sanitize first
  const sanitized = sanitizeInput(text);

  // Detect language
  const detectedLang = detectLanguage(sanitized);
  
  // Default language for rejection messages (use detected or default to 'en')
  const msgLang: SupportedLanguage = detectedLang === 'unknown' ? 'en' : detectedLang;

  // Check: Not empty
  if (!sanitized || sanitized.length === 0) {
    logger.debug('Validation failed: empty input');
    return {
      valid: false,
      language: msgLang,
      sanitized: '',
      rejection: REJECTION_MESSAGES.generic[msgLang],
    };
  }

  // Check: Minimum length
  if (sanitized.length < DEFAULT_CONFIG.minQueryLength) {
    logger.debug('Validation failed: too short', { length: sanitized.length });
    return {
      valid: false,
      language: msgLang,
      sanitized,
      rejection: REJECTION_MESSAGES.tooShort[msgLang],
    };
  }

  // Check: Maximum length
  if (sanitized.length > DEFAULT_CONFIG.maxQueryLength) {
    logger.debug('Validation failed: too long', { length: sanitized.length });
    return {
      valid: false,
      language: msgLang,
      sanitized: sanitized.substring(0, DEFAULT_CONFIG.maxQueryLength),
      rejection: REJECTION_MESSAGES.tooLong[msgLang],
    };
  }

  // Check: Language must be supported
  if (detectedLang === 'unknown') {
    logger.debug('Validation failed: unsupported language');
    return {
      valid: false,
      language: 'en', // Default for rejection message
      sanitized,
      rejection: REJECTION_MESSAGES.languageNotSupported.en,
    };
  }

  // Check: Spam patterns
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(sanitized)) {
      logger.debug('Validation failed: spam detected', { pattern: pattern.source });
      return {
        valid: false,
        language: detectedLang,
        sanitized,
        rejection: REJECTION_MESSAGES.spam[detectedLang],
      };
    }
  }

  // Check: Profanity (light filter)
  for (const pattern of PROFANITY_PATTERNS) {
    if (pattern.test(sanitized)) {
      logger.debug('Validation failed: profanity detected');
      return {
        valid: false,
        language: detectedLang,
        sanitized,
        rejection: REJECTION_MESSAGES.profanity[detectedLang],
      };
    }
  }

  // All checks passed
  logger.debug('Validation passed', { 
    language: detectedLang, 
    length: sanitized.length 
  });

  return {
    valid: true,
    language: detectedLang,
    sanitized,
  };
}

// ============================================================================
// Response Language
// ============================================================================

/**
 * Get the appropriate response language
 * 
 * Used to determine which language to use for AI responses
 * based on the detected input language.
 * 
 * @param lang - Detected input language
 * @returns Language to use for response
 * 
 * @example
 * ```typescript
 * getResponseLanguage('tr') // 'tr'
 * getResponseLanguage('en') // 'en'
 * ```
 */
export function getResponseLanguage(lang: SupportedLanguage): SupportedLanguage {
  // For now, respond in the same language as the input
  // This could be extended to support user preferences
  return lang;
}

/**
 * Get rejection message in specified language
 * 
 * @param key - Message key
 * @param lang - Target language
 * @returns Localized rejection message
 */
export function getRejectionMessage(
  key: keyof RejectionMessages,
  lang: SupportedLanguage
): string {
  return REJECTION_MESSAGES[key][lang];
}

// ============================================================================
// Policy Checks (Extended)
// ============================================================================

/**
 * Initialize the policy service with custom configuration
 * 
 * @param config - Custom policy configuration
 */
export async function initializePolicyService(
  config: Partial<PolicyConfig> = {}
): Promise<void> {
  Object.assign(DEFAULT_CONFIG, config);
  logger.info('Policy service initialized', {
    maxQueryLength: DEFAULT_CONFIG.maxQueryLength,
    minQueryLength: DEFAULT_CONFIG.minQueryLength,
    contentModeration: DEFAULT_CONFIG.enableContentModeration,
  });
}

/**
 * Check if a query passes all policy checks
 * 
 * @param query - Query text to check
 * @returns Policy check result
 */
export async function checkQueryPolicy(query: string): Promise<PolicyCheckResult> {
  const violations: PolicyViolation[] = [];
  const validation = validateInput(query);

  if (!validation.valid) {
    violations.push({
      type: 'content',
      message: validation.rejection || 'Validation failed',
      severity: 'medium',
    });
  }

  return {
    allowed: validation.valid,
    reason: validation.rejection,
    violations,
  };
}

/**
 * Check if a response passes all policy checks
 * 
 * @param response - Response text to check
 * @returns Policy check result
 */
export async function checkResponsePolicy(response: string): Promise<PolicyCheckResult> {
  const violations: PolicyViolation[] = [];

  // Check length
  if (response.length > DEFAULT_CONFIG.maxResponseLength) {
    violations.push({
      type: 'length',
      message: 'Response exceeds maximum length',
      severity: 'low',
    });
  }

  // Check for profanity in response
  for (const pattern of PROFANITY_PATTERNS) {
    if (pattern.test(response)) {
      violations.push({
        type: 'content',
        message: 'Response contains inappropriate content',
        severity: 'high',
      });
      break;
    }
  }

  return {
    allowed: violations.length === 0,
    reason: violations.length > 0 ? violations[0].message : undefined,
    violations,
  };
}

/**
 * Check if a document is allowed for ingestion
 * 
 * @param filename - Document filename
 * @param fileType - File type/extension
 * @param fileSize - File size in bytes
 * @returns Policy check result
 */
export function checkDocumentPolicy(
  filename: string,
  fileType: string,
  fileSize: number
): PolicyCheckResult {
  const violations: PolicyViolation[] = [];

  // Check file type
  if (!DEFAULT_CONFIG.allowedDocumentTypes.includes(fileType.toLowerCase())) {
    violations.push({
      type: 'format',
      message: `File type '${fileType}' is not allowed`,
      severity: 'high',
    });
  }

  // Check file size (max 50MB)
  const maxSize = 50 * 1024 * 1024;
  if (fileSize > maxSize) {
    violations.push({
      type: 'length',
      message: 'File exceeds maximum size (50MB)',
      severity: 'high',
    });
  }

  // Check filename for suspicious patterns
  if (/[<>:"|?*]/.test(filename)) {
    violations.push({
      type: 'format',
      message: 'Filename contains invalid characters',
      severity: 'medium',
    });
  }

  return {
    allowed: violations.length === 0,
    reason: violations.length > 0 ? violations[0].message : undefined,
    violations,
  };
}

/**
 * Filter sensitive information from text
 * 
 * @param text - Text to filter
 * @returns Filtered text with sensitive info masked
 */
export function filterSensitiveInfo(text: string): string {
  let filtered = text;

  // Mask email addresses
  filtered = filtered.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    '[EMAIL]'
  );

  // Mask phone numbers (various formats)
  filtered = filtered.replace(
    /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    '[PHONE]'
  );

  // Mask credit card numbers
  filtered = filtered.replace(
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    '[CARD]'
  );

  // Mask TC Kimlik No (Turkish ID)
  filtered = filtered.replace(/\b\d{11}\b/g, '[TC_KIMLIK]');

  return filtered;
}

/**
 * Log a policy violation for auditing
 * 
 * @param violation - Violation details
 * @param context - Additional context
 */
export function logPolicyViolation(
  violation: PolicyViolation,
  context: Record<string, unknown>
): void {
  logger.warn('Policy violation detected', {
    type: violation.type,
    message: violation.message,
    severity: violation.severity,
    ...context,
  });
}

// ============================================================================
// Exports
// ============================================================================

export default {
  // Core functions
  detectLanguage,
  validateInput,
  sanitizeInput,
  getResponseLanguage,
  getRejectionMessage,
  
  // Policy checks
  initializePolicyService,
  checkQueryPolicy,
  checkResponsePolicy,
  checkDocumentPolicy,
  filterSensitiveInfo,
  logPolicyViolation,
  
  // Constants
  DEFAULT_CONFIG,
  REJECTION_MESSAGES,
};
