/**
 * OCR Service Module
 * @module services/ocrService
 * 
 * Handles text extraction from images and scanned documents using Tesseract.js
 * Supports English (eng) and Turkish (tur) languages
 */

import Tesseract, { Worker, createWorker } from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { logger } from './loggerService';

const readFile = promisify(fs.readFile);

// ============================================================================
// Constants
// ============================================================================

/** Minimum characters per page to consider document as having extractable text */
const OCR_THRESHOLD_CHARS_PER_PAGE = 100;

/** Supported OCR languages */
const SUPPORTED_LANGUAGES = ['eng', 'tur'] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

/** Default language combination for OCR */
const DEFAULT_LANGUAGES: SupportedLanguage[] = ['eng', 'tur'];

// ============================================================================
// Types
// ============================================================================

/**
 * OCR processing result
 */
export interface OCRResult {
  /** Extracted text content */
  text: string;
  /** Overall confidence score (0-100) */
  confidence: number;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Languages used for recognition */
  languages: string[];
  /** Per-page results (if multi-page) */
  pages?: OCRPageResult[];
  /** Whether OCR was actually performed */
  ocrPerformed: boolean;
  /** Any warnings during processing */
  warnings?: string[];
}

/**
 * Per-page OCR result
 */
export interface OCRPageResult {
  /** Page number (1-based) */
  pageNumber: number;
  /** Extracted text for this page */
  text: string;
  /** Confidence score for this page (0-100) */
  confidence: number;
  /** Detected text blocks */
  blocks?: OCRBlock[];
}

/**
 * Text block detected by OCR
 */
export interface OCRBlock {
  /** Block text content */
  text: string;
  /** Confidence score (0-100) */
  confidence: number;
  /** Bounding box coordinates */
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  /** Block type (paragraph, line, word) */
  blockType: 'paragraph' | 'line' | 'word';
}

/**
 * OCR metadata flags for document processing
 */
export interface OCRMetadata {
  /** Whether OCR was needed */
  ocrNeeded: boolean;
  /** Whether OCR was performed */
  ocrPerformed: boolean;
  /** OCR confidence score (0-100, undefined if not performed) */
  ocrConfidence?: number;
  /** Languages used */
  ocrLanguages?: string[];
  /** Processing time in ms */
  ocrProcessingTimeMs?: number;
}

/**
 * Configuration for OCR service
 */
export interface OCRServiceConfig {
  /** Languages to use for OCR */
  languages: SupportedLanguage[];
  /** Path to cache Tesseract data */
  cachePath?: string;
  /** Confidence threshold to accept results */
  minConfidence?: number;
}

// ============================================================================
// Service State
// ============================================================================

let worker: Worker | null = null;
let isInitialized = false;
let currentLanguages: string[] = [];

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the OCR service with Tesseract worker
 * @param config - OCR configuration options
 */
export async function initializeOCR(
  config: Partial<OCRServiceConfig> = {}
): Promise<void> {
  const startTime = Date.now();
  const languages = config.languages || DEFAULT_LANGUAGES;
  const langString = languages.join('+');

  logger.info('Initializing OCR service', { languages });

  try {
    // Create and initialize worker
    worker = await createWorker(langString, 1, {
      cachePath: config.cachePath,
      logger: (m) => {
        if (m.status === 'recognizing text') {
          logger.debug('OCR progress', { progress: Math.round(m.progress * 100) });
        }
      },
    });

    currentLanguages = languages;
    isInitialized = true;

    const duration = Date.now() - startTime;
    logger.info('OCR service initialized', { 
      languages, 
      durationMs: duration 
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to initialize OCR service', { error: errorMessage });
    throw new Error(`OCR initialization failed: ${errorMessage}`);
  }
}

/**
 * Ensure OCR service is initialized
 */
async function ensureInitialized(): Promise<void> {
  if (!isInitialized || !worker) {
    await initializeOCR();
  }
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Determine if OCR is needed based on text content and page count
 * @param text - Extracted text content (may be empty or sparse)
 * @param pageCount - Number of pages in the document
 * @returns True if OCR should be performed
 */
export function needsOCR(text: string, pageCount: number): boolean {
  // Handle edge cases
  if (pageCount <= 0) {
    logger.warn('Invalid page count for OCR check', { pageCount });
    return true;
  }

  // If no text at all, definitely needs OCR
  if (!text || text.trim().length === 0) {
    logger.debug('Document has no text, OCR needed');
    return true;
  }

  // Calculate characters per page
  const charsPerPage = text.length / pageCount;
  const ocrNeeded = charsPerPage < OCR_THRESHOLD_CHARS_PER_PAGE;

  logger.debug('OCR need assessment', {
    totalChars: text.length,
    pageCount,
    charsPerPage: Math.round(charsPerPage),
    threshold: OCR_THRESHOLD_CHARS_PER_PAGE,
    ocrNeeded,
  });

  return ocrNeeded;
}

/**
 * Perform OCR on a PDF buffer or image buffer
 * @param buffer - PDF or image buffer to process
 * @param options - Processing options
 * @returns OCR result with text and confidence
 */
export async function performOCR(
  buffer: Buffer,
  options: { languages?: SupportedLanguage[] } = {}
): Promise<OCRResult> {
  const startTime = Date.now();
  const warnings: string[] = [];

  logger.info('Starting OCR processing', { 
    bufferSize: buffer.length,
    languages: options.languages || currentLanguages,
  });

  try {
    await ensureInitialized();

    if (!worker) {
      throw new Error('OCR worker not available');
    }

    // Change languages if different from current
    const requestedLangs = options.languages || DEFAULT_LANGUAGES;
    const langString = requestedLangs.join('+');
    
    if (langString !== currentLanguages.join('+')) {
      logger.debug('Switching OCR languages', { 
        from: currentLanguages, 
        to: requestedLangs 
      });
      await worker.reinitialize(langString);
      currentLanguages = requestedLangs;
    }

    // Perform recognition
    const result = await worker.recognize(buffer);

    // Extract blocks for detailed analysis
    const blocks = extractBlocks(result.data);

    // Calculate overall confidence
    const confidence = result.data.confidence;

    // Check for low confidence warning
    if (confidence < 50) {
      warnings.push(`Low OCR confidence: ${confidence.toFixed(1)}%. Results may be unreliable.`);
      logger.warn('Low OCR confidence', { confidence });
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info('OCR processing completed', {
      textLength: result.data.text.length,
      confidence: confidence.toFixed(1),
      processingTimeMs,
    });

    return {
      text: result.data.text,
      confidence,
      processingTimeMs,
      languages: requestedLangs,
      ocrPerformed: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      pages: [{
        pageNumber: 1,
        text: result.data.text,
        confidence,
        blocks,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const processingTimeMs = Date.now() - startTime;
    
    logger.error('OCR processing failed', { 
      error: errorMessage,
      processingTimeMs,
    });

    throw new Error(`OCR failed: ${errorMessage}`);
  }
}

/**
 * Process a document file with OCR
 * @param filePath - Path to the document or image file
 * @param options - Processing options
 * @returns OCR result with extracted text and metadata
 */
export async function processDocumentWithOCR(
  filePath: string,
  options: { languages?: SupportedLanguage[]; forceOCR?: boolean } = {}
): Promise<OCRResult & { metadata: OCRMetadata }> {
  const startTime = Date.now();
  const absolutePath = path.resolve(filePath);

  logger.info('Processing document with OCR', { filePath: absolutePath });

  // Validate file exists
  if (!fs.existsSync(absolutePath)) {
    const error = new Error(`File not found: ${absolutePath}`);
    logger.error('Document not found for OCR', { filePath: absolutePath });
    throw error;
  }

  // Read file
  const buffer = await readFile(absolutePath);
  const ext = path.extname(filePath).toLowerCase();

  // Check if it's a supported image format
  const imageFormats = ['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.gif', '.webp'];
  const isImage = imageFormats.includes(ext);

  // For PDFs, we need special handling (convert pages to images)
  // This is a simplified version - full PDF OCR would need pdf-to-image conversion
  if (ext === '.pdf') {
    logger.warn('PDF OCR requires page-by-page image conversion', { filePath });
    // For now, we'll attempt direct OCR which works on some PDFs
    // Full implementation would use pdf-poppler or similar to convert pages
  }

  if (!isImage && ext !== '.pdf') {
    throw new Error(`Unsupported file format for OCR: ${ext}`);
  }

  try {
    const ocrResult = await performOCR(buffer, { 
      languages: options.languages 
    });

    const processingTimeMs = Date.now() - startTime;

    const metadata: OCRMetadata = {
      ocrNeeded: true,
      ocrPerformed: true,
      ocrConfidence: ocrResult.confidence,
      ocrLanguages: ocrResult.languages,
      ocrProcessingTimeMs: processingTimeMs,
    };

    logger.info('Document OCR completed', {
      filePath: absolutePath,
      textLength: ocrResult.text.length,
      confidence: ocrResult.confidence.toFixed(1),
      processingTimeMs,
    });

    return {
      ...ocrResult,
      processingTimeMs,
      metadata,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const processingTimeMs = Date.now() - startTime;

    logger.error('Document OCR failed', {
      filePath: absolutePath,
      error: errorMessage,
      processingTimeMs,
    });

    throw error;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract text blocks from Tesseract result
 */
function extractBlocks(data: Tesseract.Page): OCRBlock[] {
  const blocks: OCRBlock[] = [];

  // Extract paragraphs
  if (data.paragraphs) {
    for (const para of data.paragraphs) {
      blocks.push({
        text: para.text,
        confidence: para.confidence,
        bbox: {
          x0: para.bbox.x0,
          y0: para.bbox.y0,
          x1: para.bbox.x1,
          y1: para.bbox.y1,
        },
        blockType: 'paragraph',
      });
    }
  }

  return blocks;
}

/**
 * Clean OCR output text
 * @param text - Raw OCR text
 * @returns Cleaned text
 */
export function cleanOCRText(text: string): string {
  return text
    // Normalize line breaks
    .replace(/\r\n/g, '\n')
    // Remove excessive whitespace but keep paragraph breaks
    .replace(/[^\S\n]+/g, ' ')
    // Remove multiple consecutive blank lines
    .replace(/\n{3,}/g, '\n\n')
    // Remove common OCR artifacts
    .replace(/[|¦]/g, 'I')
    .replace(/[`´]/g, "'")
    // Trim
    .trim();
}

/**
 * Check if text appears to be Turkish
 */
export function detectTurkish(text: string): boolean {
  // Turkish-specific characters
  const turkishChars = /[ğĞıİöÖüÜşŞçÇ]/;
  return turkishChars.test(text);
}

/**
 * Get recommended languages based on text sample
 */
export function getRecommendedLanguages(textSample: string): SupportedLanguage[] {
  if (detectTurkish(textSample)) {
    return ['tur', 'eng']; // Turkish first
  }
  return ['eng', 'tur']; // English first
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Terminate OCR worker and clean up resources
 */
export async function terminateOCR(): Promise<void> {
  if (worker) {
    logger.info('Terminating OCR service');
    await worker.terminate();
    worker = null;
    isInitialized = false;
    currentLanguages = [];
    logger.info('OCR service terminated');
  }
}

/**
 * Check if OCR service is initialized
 */
export function isOCRInitialized(): boolean {
  return isInitialized && worker !== null;
}

// ============================================================================
// Exports
// ============================================================================

export default {
  initializeOCR,
  needsOCR,
  performOCR,
  processDocumentWithOCR,
  cleanOCRText,
  detectTurkish,
  getRecommendedLanguages,
  terminateOCR,
  isOCRInitialized,
  OCR_THRESHOLD_CHARS_PER_PAGE,
};
