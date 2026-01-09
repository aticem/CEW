/**
 * QAQC Snapshot Connector
 * @module connectors/qaqcSnapshotConnector
 * 
 * Provides access to QAQC document status snapshots for AI queries.
 * Reads from in-memory snapshot store (populated by frontend).
 */

import { getQAQCSnapshot, hasQAQCSnapshot, QAQCSnapshot, QAQCCategoryCounts } from '../routes/qaqcSnapshot';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * QAQC overview result
 */
export interface QAQCOverview {
  available: boolean;
  timestamp: string | null;
  overall: QAQCCategoryCounts | null;
  byCategory: Record<string, QAQCCategoryCounts> | null;
}

/**
 * QAQC category result
 */
export interface QAQCCategoryResult {
  available: boolean;
  categoryKey: string;
  categoryLabel: string;
  counts: QAQCCategoryCounts | null;
}

// ============================================================================
// Category Labels
// ============================================================================

const CATEGORY_LABELS: Record<string, string> = {
  ITPs: 'ITPs (Inspection and Test Plans)',
  Checklists: 'Checklists',
  NCRs: 'NCRs (Non-Conformance Reports)',
  ThirdParty: 'Third Party Documents',
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get QAQC overview with all categories
 */
export function getQAQCOverview(): QAQCOverview {
  const snapshot = getQAQCSnapshot();

  if (!snapshot) {
    logger.debug('QAQC snapshot not available');
    return {
      available: false,
      timestamp: null,
      overall: null,
      byCategory: null,
    };
  }

  return {
    available: true,
    timestamp: snapshot.timestamp,
    overall: snapshot.totals.overall,
    byCategory: snapshot.totals.byCategory,
  };
}

/**
 * Get QAQC counts for a specific category
 * 
 * @param categoryKey - Category key (ITPs, Checklists, NCRs, ThirdParty)
 */
export function getQAQCByCategory(categoryKey: string): QAQCCategoryResult {
  const snapshot = getQAQCSnapshot();
  const normalizedKey = normalizeCategoryKey(categoryKey);
  const label = CATEGORY_LABELS[normalizedKey] || normalizedKey;

  if (!snapshot) {
    return {
      available: false,
      categoryKey: normalizedKey,
      categoryLabel: label,
      counts: null,
    };
  }

  const counts = snapshot.totals.byCategory[normalizedKey];

  if (!counts) {
    return {
      available: false,
      categoryKey: normalizedKey,
      categoryLabel: label,
      counts: null,
    };
  }

  return {
    available: true,
    categoryKey: normalizedKey,
    categoryLabel: label,
    counts,
  };
}

/**
 * Check if QAQC snapshot is available
 */
export function isQAQCAvailable(): boolean {
  return hasQAQCSnapshot();
}

/**
 * Identify QAQC category from query text
 * 
 * @param query - User query
 * @returns Category key or null if not identified
 */
export function identifyQAQCCategory(query: string): string | null {
  const normalizedQuery = query.toLowerCase();

  // Check for specific category mentions
  if (/\bncr\b|non.?conformance/i.test(normalizedQuery)) {
    return 'NCRs';
  }
  if (/\bitp\b|inspection.*test.*plan/i.test(normalizedQuery)) {
    return 'ITPs';
  }
  if (/\bchecklist\b|kontrol listesi/i.test(normalizedQuery)) {
    return 'Checklists';
  }
  if (/\bthird.?party\b|\bdnv\b|\bcea\b|üçüncü taraf/i.test(normalizedQuery)) {
    return 'ThirdParty';
  }

  return null;
}

/**
 * Check if query is asking for QAQC counts/status
 */
export function isQAQCCountQuery(query: string): boolean {
  const normalizedQuery = query.toLowerCase();

  // Must mention QAQC or a category
  const mentionsQAQC = /\bqaqc\b|\bqa\/qc\b|\bncr\b|\bitp\b|\bchecklist\b|\bthird.?party\b|\bdnv\b|\bcea\b/i.test(normalizedQuery);
  
  if (!mentionsQAQC) {
    return false;
  }

  // Check for count/status keywords
  const countKeywords = /kaç|sayı|toplam|tamamlan|açık|open|closed|completed|status|durum|count|total|how many|remaining|kalan/i;
  
  return countKeywords.test(normalizedQuery);
}

// ============================================================================
// Response Generation (NO LLM)
// ============================================================================

/**
 * Generate deterministic response for QAQC count query
 * 
 * @param query - User query
 * @param language - Response language
 * @returns Response text (no LLM)
 */
export function generateQAQCCountResponse(query: string, language: 'tr' | 'en'): string {
  const overview = getQAQCOverview();

  // Check if snapshot is available
  if (!overview.available || !overview.overall) {
    return language === 'tr'
      ? 'QAQC durumu henüz yüklenmedi. Lütfen QAQC ekranını açıp bir işlem yaptıktan sonra tekrar deneyin.'
      : 'QAQC status has not been loaded yet. Please open the QAQC screen and perform an action, then try again.';
  }

  // Check if asking for specific category
  const category = identifyQAQCCategory(query);

  if (category) {
    const catResult = getQAQCByCategory(category);
    
    if (!catResult.available || !catResult.counts) {
      return language === 'tr'
        ? `${catResult.categoryLabel} kategorisi için veri bulunamadı.`
        : `No data found for ${catResult.categoryLabel} category.`;
    }

    const { total, done, open } = catResult.counts;
    const statusWord = category === 'NCRs' ? (language === 'tr' ? 'closed' : 'closed') : (language === 'tr' ? 'tamamlanmış' : 'completed');
    const openWord = category === 'NCRs' ? 'open' : (language === 'tr' ? 'açık' : 'open');

    if (language === 'tr') {
      return `📋 **${catResult.categoryLabel}** Durumu:\n\n` +
             `• Toplam: **${total}** doküman\n` +
             `• ${statusWord}: **${done}**\n` +
             `• ${openWord}: **${open}**`;
    } else {
      return `📋 **${catResult.categoryLabel}** Status:\n\n` +
             `• Total: **${total}** documents\n` +
             `• ${statusWord}: **${done}**\n` +
             `• ${openWord}: **${open}**`;
    }
  }

  // Return overall QAQC status
  const { total, done, open } = overview.overall;
  const byCategory = overview.byCategory!;

  if (language === 'tr') {
    let response = `📊 **QAQC Genel Durumu:**\n\n`;
    response += `• Toplam: **${total}** doküman\n`;
    response += `• Tamamlanmış: **${done}**\n`;
    response += `• Açık: **${open}**\n\n`;
    response += `**Kategorilere Göre:**\n`;
    
    for (const [key, counts] of Object.entries(byCategory)) {
      const label = CATEGORY_LABELS[key] || key;
      response += `• ${label}: ${counts.done}/${counts.total}\n`;
    }

    return response;
  } else {
    let response = `📊 **QAQC Overview:**\n\n`;
    response += `• Total: **${total}** documents\n`;
    response += `• Completed: **${done}**\n`;
    response += `• Open: **${open}**\n\n`;
    response += `**By Category:**\n`;
    
    for (const [key, counts] of Object.entries(byCategory)) {
      const label = CATEGORY_LABELS[key] || key;
      response += `• ${label}: ${counts.done}/${counts.total}\n`;
    }

    return response;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize category key (handle variations)
 */
function normalizeCategoryKey(key: string): string {
  const normalized = key.toLowerCase().trim();
  
  if (normalized.includes('ncr')) return 'NCRs';
  if (normalized.includes('itp')) return 'ITPs';
  if (normalized.includes('checklist')) return 'Checklists';
  if (normalized.includes('third') || normalized.includes('party')) return 'ThirdParty';
  
  // Try direct match
  const directMatch = ['ITPs', 'Checklists', 'NCRs', 'ThirdParty'].find(
    k => k.toLowerCase() === normalized
  );
  
  return directMatch || key;
}

// ============================================================================
// Exports
// ============================================================================

export default {
  getQAQCOverview,
  getQAQCByCategory,
  isQAQCAvailable,
  identifyQAQCCategory,
  isQAQCCountQuery,
  generateQAQCCountResponse,
};
