import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import {
  DocumentMetadata,
  DocumentChunk,
  ParsedDocument,
  DocumentFileType,
  ChunkMetadata,
} from '../types';
import { config } from '../config';
import { logger } from '../services/logger';

// =============================================================================
// Constants
// =============================================================================

/** Minimum characters per page to consider PDF as having extractable text */
const PDF_TEXT_THRESHOLD = 100;

/** Supported file extensions mapped to document types */
const SUPPORTED_EXTENSIONS: Record<string, DocumentFileType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.txt': 'txt',
  '.csv': 'csv',
};

// =============================================================================
// Types
// =============================================================================

/**
 * Result of loading multiple documents with error tracking
 */
export interface LoadAllDocumentsResult {
  /** Successfully parsed documents */
  documents: ParsedDocument[];
  /** Summary of any errors encountered */
  errors: DocumentLoadError[];
  /** Total files found */
  totalFiles: number;
  /** Successfully loaded count */
  successCount: number;
  /** Failed count */
  failedCount: number;
}

/**
 * Error information for a failed document load
 */
export interface DocumentLoadError {
  /** Path to the file that failed */
  filePath: string;
  /** Error message */
  error: string;
  /** Timestamp of the error */
  timestamp: Date;
}

/**
 * Intermediate page content during parsing
 */
interface PageContent {
  pageNumber: number;
  content: string;
  needsOCR?: boolean;
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Load and parse a single document from the filesystem
 *
 * @param filePath - Absolute or relative path to the document
 * @returns Parsed document with metadata and empty chunks (chunks are created by chunker)
 * @throws Error if file type is unsupported or file cannot be read
 *
 * @example
 * ```typescript
 * const doc = await loadDocument('/path/to/document.pdf');
 * console.log(doc.metadata.filename); // 'document.pdf'
 * ```
 */
export async function loadDocument(filePath: string): Promise<ParsedDocument> {
  const startTime = Date.now();
  const absolutePath = path.resolve(filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const fileType = SUPPORTED_EXTENSIONS[ext];

  // Validate file type
  if (!fileType) {
    const supported = Object.keys(SUPPORTED_EXTENSIONS).join(', ');
    throw new Error(`Unsupported file type: ${ext}. Supported types: ${supported}`);
  }

  // Check file exists and get stats
  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${absolutePath}`);
  }

  // Create base metadata
  const metadata: DocumentMetadata = {
    id: uuidv4(),
    filename: path.basename(absolutePath),
    source: 'local_documents',
    logicalPath: getLogicalPath(absolutePath),
    filetype: fileType,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Parse document based on type
  let pages: PageContent[];

  switch (fileType) {
    case 'pdf':
      pages = await parsePDF(absolutePath, metadata);
      break;
    case 'docx':
      pages = await parseDOCX(absolutePath, metadata);
      break;
    case 'xlsx':
      pages = await parseXLSX(absolutePath, metadata);
      break;
    case 'txt':
    case 'csv':
      pages = await parseText(absolutePath);
      break;
    default:
      throw new Error(`Parser not implemented for type: ${fileType}`);
  }

  // Create chunks from pages (basic chunking - proper chunking done by chunker module)
  const chunks = createInitialChunks(metadata.id, pages);

  const processingTime = Date.now() - startTime;

  logger.info('Document loaded successfully', {
    documentId: metadata.id,
    filename: metadata.filename,
    filetype: fileType,
    pageCount: metadata.pageCount,
    chunksCreated: chunks.length,
    processingTimeMs: processingTime,
  });

  return {
    metadata,
    chunks,
  };
}

/**
 * Recursively load all supported documents from a directory
 *
 * @param directory - Path to the directory to scan
 * @returns Result object containing parsed documents and error summary
 *
 * @example
 * ```typescript
 * const result = await loadAllDocuments('/path/to/documents');
 * console.log(`Loaded ${result.successCount}/${result.totalFiles} documents`);
 * if (result.errors.length > 0) {
 *   console.log('Errors:', result.errors);
 * }
 * ```
 */
export async function loadAllDocuments(directory: string): Promise<LoadAllDocumentsResult> {
  const absoluteDir = path.resolve(directory);
  const result: LoadAllDocumentsResult = {
    documents: [],
    errors: [],
    totalFiles: 0,
    successCount: 0,
    failedCount: 0,
  };

  logger.info('Starting document scan', { directory: absoluteDir });

  // Find all supported files recursively
  const filePaths = await findSupportedFiles(absoluteDir);
  result.totalFiles = filePaths.length;

  logger.info(`Found ${filePaths.length} supported files`, { directory: absoluteDir });

  // Process each file
  for (const filePath of filePaths) {
    try {
      const doc = await loadDocument(filePath);
      result.documents.push(doc);
      result.successCount++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to load document', {
        filePath,
        error: errorMessage,
      });

      result.errors.push({
        filePath,
        error: errorMessage,
        timestamp: new Date(),
      });
      result.failedCount++;
    }
  }

  logger.info('Document scan completed', {
    directory: absoluteDir,
    totalFiles: result.totalFiles,
    successCount: result.successCount,
    failedCount: result.failedCount,
  });

  return result;
}

/**
 * Check if a file extension is supported
 *
 * @param filePath - Path to check
 * @returns True if the file type is supported
 */
export function isSupported(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext in SUPPORTED_EXTENSIONS;
}

/**
 * Get list of supported file extensions
 *
 * @returns Array of supported extensions (e.g., ['.pdf', '.docx', ...])
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(SUPPORTED_EXTENSIONS);
}

// =============================================================================
// Parser Functions
// =============================================================================

/**
 * Parse a PDF file and extract text content page by page
 * Flags documents that may need OCR processing
 */
async function parsePDF(filePath: string, metadata: DocumentMetadata): Promise<PageContent[]> {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);

  metadata.pageCount = data.numpages;

  // Check if PDF has extractable text
  const avgTextPerPage = data.text.length / data.numpages;
  const needsOCR = avgTextPerPage < PDF_TEXT_THRESHOLD;

  if (needsOCR) {
    logger.warn('PDF appears to be scanned or image-based, may need OCR', {
      documentId: metadata.id,
      filename: metadata.filename,
      avgTextPerPage: Math.round(avgTextPerPage),
      threshold: PDF_TEXT_THRESHOLD,
    });
  }

  // Split text into pages using form feed character
  const pageTexts = data.text.split('\f');
  const pages: PageContent[] = [];

  for (let i = 0; i < data.numpages; i++) {
    const content = pageTexts[i]?.trim() || '';
    pages.push({
      pageNumber: i + 1,
      content,
      needsOCR: content.length < PDF_TEXT_THRESHOLD,
    });
  }

  // If we didn't get proper page splits, use entire content as page 1
  if (pages.length === 0 || (pages.length === 1 && pages[0].content === '')) {
    pages.length = 0;
    pages.push({
      pageNumber: 1,
      content: data.text.trim(),
      needsOCR,
    });
  }

  return pages;
}

/**
 * Parse a DOCX file and extract text content
 */
async function parseDOCX(filePath: string, metadata: DocumentMetadata): Promise<PageContent[]> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });

  // Log any conversion warnings
  if (result.messages.length > 0) {
    logger.warn('DOCX conversion warnings', {
      documentId: metadata.id,
      filename: metadata.filename,
      warnings: result.messages.map(m => m.message),
    });
  }

  metadata.pageCount = 1; // DOCX doesn't have clear page boundaries

  return [{
    pageNumber: 1,
    content: result.value.trim(),
  }];
}

/**
 * Parse an XLSX file and extract content from each sheet
 */
async function parseXLSX(filePath: string, metadata: DocumentMetadata): Promise<PageContent[]> {
  const workbook = XLSX.readFile(filePath);
  const pages: PageContent[] = [];

  metadata.pageCount = workbook.SheetNames.length;

  workbook.SheetNames.forEach((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

    // Format sheet data as readable text
    const lines: string[] = [`[Sheet: ${sheetName}]`];

    if (jsonData.length > 0) {
      const headers = (jsonData[0] || []).map(h => String(h ?? ''));

      // Add header row
      if (headers.some(h => h.length > 0)) {
        lines.push(`Headers: ${headers.join(' | ')}`);
        lines.push('---');
      }

      // Add data rows with header labels
      jsonData.slice(1).forEach((row, rowIndex) => {
        const rowParts: string[] = [];
        headers.forEach((header, colIndex) => {
          const value = row[colIndex];
          if (value !== undefined && value !== null && value !== '') {
            const label = header || `Col${colIndex + 1}`;
            rowParts.push(`${label}: ${value}`);
          }
        });
        if (rowParts.length > 0) {
          lines.push(`Row ${rowIndex + 1}: ${rowParts.join(', ')}`);
        }
      });
    }

    pages.push({
      pageNumber: index + 1,
      content: lines.join('\n'),
    });
  });

  return pages;
}

/**
 * Parse a plain text file
 */
async function parseText(filePath: string): Promise<PageContent[]> {
  const content = await fs.readFile(filePath, 'utf-8');

  return [{
    pageNumber: 1,
    content: content.trim(),
  }];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Recursively find all supported files in a directory
 */
async function findSupportedFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  async function scanDirectory(dir: string): Promise<void> {
    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      logger.warn('Cannot read directory', {
        directory: dir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and common non-document directories
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await scanDirectory(fullPath);
        }
      } else if (entry.isFile() && isSupported(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  await scanDirectory(directory);
  return files;
}

/**
 * Get the logical path relative to the documents directory
 */
function getLogicalPath(absolutePath: string): string {
  const documentsDir = config.documentsPath;

  if (absolutePath.startsWith(documentsDir)) {
    const relativePath = path.relative(documentsDir, absolutePath);
    const dirPath = path.dirname(relativePath);
    return dirPath === '.' ? '/' : `/${dirPath.replace(/\\/g, '/')}`;
  }

  return '/';
}

/**
 * Create initial document chunks from parsed pages
 * Note: This creates basic chunks - use the chunker module for proper chunking with overlap
 */
function createInitialChunks(documentId: string, pages: PageContent[]): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];

  pages.forEach((page, index) => {
    if (page.content.length === 0) return;

    const chunkMetadata: ChunkMetadata = {
      pageNumber: page.pageNumber,
      chunkIndex: index,
      startOffset: 0,
      endOffset: page.content.length,
    };

    chunks.push({
      id: uuidv4(),
      documentId,
      content: page.content,
      metadata: chunkMetadata,
      embedding: [], // Will be filled by embedder
    });
  });

  return chunks;
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  loadDocument,
  loadAllDocuments,
  isSupported,
  getSupportedExtensions,
};
