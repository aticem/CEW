/**
 * CEW QAQC Document Connector
 * @module connectors/cewQAQCConnector
 * 
 * Provides read-only access to QAQC documents in the CEW frontend.
 * Used for RAG ingestion - documents are indexed for content Q&A.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../services/loggerService';
import config from '../config';

// ============================================================================
// Types
// ============================================================================

/**
 * QAQC document file info
 */
export interface QAQCFileInfo {
  /** Absolute path to file */
  absolutePath: string;
  /** Path relative to QAQC root (e.g., "Checklists/electrical/dc-cable/file.pdf") */
  relativePath: string;
  /** Logical path for AI (e.g., "QAQC/Checklists/electrical/dc-cable/file.pdf") */
  logicalPath: string;
  /** File name */
  filename: string;
  /** File extension (lowercase, no dot) */
  extension: string;
  /** QAQC category (ITPs, Checklists, NCRs, ThirdParty) */
  category: string;
  /** Sub-category path (e.g., "electrical/dc-cable") */
  subCategory: string;
}

/**
 * QAQC connector configuration
 */
export interface QAQCConnectorConfig {
  /** Path to CEW QAQC directory (relative or absolute) */
  qaqcPath: string;
  /** Supported file extensions */
  supportedExtensions: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: QAQCConnectorConfig = {
  qaqcPath: config.paths?.cewQAQC || '../CEW1/_root/public/QAQC',
  supportedExtensions: ['pdf', 'docx', 'xlsx', 'xls', 'doc', 'txt'],
};

// Main categories in QAQC
const QAQC_CATEGORIES = ['ITPs', 'Checklists', 'NCRs', 'ThirdParty'];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get the absolute path to QAQC directory
 */
export function getQAQCPath(): string {
  const configuredPath = config.paths?.cewQAQC || DEFAULT_CONFIG.qaqcPath;
  
  // If absolute, use as-is
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }
  
  // Relative to project root
  return path.resolve(process.cwd(), configuredPath);
}

/**
 * Check if QAQC directory exists and is accessible
 */
export function isQAQCAvailable(): boolean {
  try {
    const qaqcPath = getQAQCPath();
    return fs.existsSync(qaqcPath) && fs.statSync(qaqcPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * List all QAQC document files recursively
 * 
 * @param customConfig - Optional custom configuration
 * @returns Array of QAQC file info objects
 */
export function listQAQCFiles(customConfig?: Partial<QAQCConnectorConfig>): QAQCFileInfo[] {
  const cfg = { ...DEFAULT_CONFIG, ...customConfig };
  const qaqcRoot = getQAQCPath();
  
  if (!isQAQCAvailable()) {
    logger.warn('QAQC directory not available', { path: qaqcRoot });
    return [];
  }

  const files: QAQCFileInfo[] = [];
  const supportedExtSet = new Set(cfg.supportedExtensions.map(e => e.toLowerCase()));

  /**
   * Recursively scan directory
   */
  function scanDirectory(dirPath: string, relativePath: string, category: string, subCategory: string): void {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          // Determine category and sub-category
          let newCategory = category;
          let newSubCategory = subCategory;

          if (!category) {
            // First level - this is the category
            if (QAQC_CATEGORIES.includes(entry.name)) {
              newCategory = entry.name;
            } else {
              newCategory = 'Other';
            }
          } else {
            // Deeper levels - build sub-category path
            newSubCategory = subCategory ? `${subCategory}/${entry.name}` : entry.name;
          }

          scanDirectory(entryPath, entryRelPath, newCategory, newSubCategory);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).slice(1).toLowerCase();
          
          if (supportedExtSet.has(ext)) {
            files.push({
              absolutePath: entryPath,
              relativePath: entryRelPath,
              logicalPath: `QAQC/${entryRelPath}`,
              filename: entry.name,
              extension: ext,
              category: category || 'Other',
              subCategory: subCategory,
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error scanning QAQC directory', {
        path: dirPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Start scanning from QAQC root
  scanDirectory(qaqcRoot, '', '', '');

  logger.info('QAQC files discovered', {
    totalFiles: files.length,
    byCategory: getCategoryStats(files),
  });

  return files;
}

/**
 * Get files by category
 * 
 * @param category - QAQC category (ITPs, Checklists, NCRs, ThirdParty)
 */
export function getFilesByCategory(category: string): QAQCFileInfo[] {
  const allFiles = listQAQCFiles();
  return allFiles.filter(f => f.category === category);
}

/**
 * Get category statistics
 */
export function getCategoryStats(files?: QAQCFileInfo[]): Record<string, number> {
  const fileList = files || listQAQCFiles();
  const stats: Record<string, number> = {};

  for (const file of fileList) {
    stats[file.category] = (stats[file.category] || 0) + 1;
  }

  return stats;
}

/**
 * Get total document count
 */
export function getTotalDocumentCount(): number {
  return listQAQCFiles().length;
}

/**
 * Check if a path is within QAQC directory
 */
export function isQAQCPath(filePath: string): boolean {
  const qaqcRoot = getQAQCPath();
  const absolutePath = path.resolve(filePath);
  return absolutePath.startsWith(qaqcRoot);
}

/**
 * Get document category from path
 * 
 * @param filePath - File path (absolute or relative)
 * @returns Category name or 'Other'
 */
export function getCategoryFromPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  for (const cat of QAQC_CATEGORIES) {
    if (normalizedPath.includes(`/${cat}/`) || normalizedPath.includes(`\\${cat}\\`)) {
      return cat;
    }
  }

  // Check if starts with category
  for (const cat of QAQC_CATEGORIES) {
    if (normalizedPath.startsWith(cat)) {
      return cat;
    }
  }

  return 'Other';
}

/**
 * Get sub-category from path
 * 
 * @param filePath - File path relative to QAQC root
 */
export function getSubCategoryFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  
  // Remove category (first part) and filename (last part)
  if (parts.length <= 2) {
    return '';
  }

  return parts.slice(1, -1).join('/');
}

// ============================================================================
// RAG Integration Helpers
// ============================================================================

/**
 * Check if query mentions QAQC documents
 * Used to filter retrieval results
 */
export function isQAQCQuery(query: string): boolean {
  const normalizedQuery = query.toLowerCase();
  
  // Direct QAQC mentions
  if (/\bqaqc\b|\bqa\/qc\b/.test(normalizedQuery)) {
    return true;
  }

  // Category mentions
  if (/\bncr\b|\bitp\b|\bchecklist\b|kontrol listesi/.test(normalizedQuery)) {
    return true;
  }

  // Third party mentions
  if (/\bdnv\b|\bcea\b|\bthird.?party\b|üçüncü taraf/.test(normalizedQuery)) {
    return true;
  }

  return false;
}

/**
 * Get filter criteria for QAQC retrieval
 * 
 * @param query - User query
 * @returns Filter object or null if no specific category
 */
export function getQAQCFilterFromQuery(query: string): { source?: string; category?: string } | null {
  const normalizedQuery = query.toLowerCase();

  // Check for specific categories
  if (/\bncr\b|non.?conformance/.test(normalizedQuery)) {
    return { source: 'cew_qaqc', category: 'NCRs' };
  }
  if (/\bitp\b|inspection.*test/.test(normalizedQuery)) {
    return { source: 'cew_qaqc', category: 'ITPs' };
  }
  if (/\bchecklist\b|kontrol listesi/.test(normalizedQuery)) {
    return { source: 'cew_qaqc', category: 'Checklists' };
  }
  if (/\bdnv\b|\bcea\b|\bthird.?party\b|üçüncü taraf/.test(normalizedQuery)) {
    return { source: 'cew_qaqc', category: 'ThirdParty' };
  }

  // Generic QAQC query - filter by source only
  if (isQAQCQuery(query)) {
    return { source: 'cew_qaqc' };
  }

  return null;
}

// ============================================================================
// Exports
// ============================================================================

export default {
  getQAQCPath,
  isQAQCAvailable,
  listQAQCFiles,
  getFilesByCategory,
  getCategoryStats,
  getTotalDocumentCount,
  isQAQCPath,
  getCategoryFromPath,
  getSubCategoryFromPath,
  isQAQCQuery,
  getQAQCFilterFromQuery,
  QAQC_CATEGORIES,
};
