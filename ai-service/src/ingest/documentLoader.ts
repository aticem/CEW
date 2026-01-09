/**
 * Document Loader Module
 * @module ingest/documentLoader
 * 
 * Handles loading and parsing various document formats:
 * - PDF (pdf-parse, page aware)
 * - DOCX (mammoth)
 * - XLSX (xlsx, sheet-based)
 * - TXT/CSV (plain text)
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { 
  ParsedDocument, 
  DocumentMetadata, 
  DocumentChunk, 
  FileType 
} from '../types';
import { logger } from '../services/loggerService';

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// ============================================================================
// Constants
// ============================================================================

/** Source identifier for locally loaded documents */
const DOCUMENT_SOURCE = 'local_documents';

/** Supported file extensions */
const SUPPORTED_EXTENSIONS: Record<string, FileType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.txt': 'txt',
  '.csv': 'csv',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.tiff': 'image',
  '.tif': 'image',
};

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Result of parsing a PDF with page information
 */
interface PDFParseResult {
  text: string;
  pageCount: number;
  pages: Array<{ pageNumber: number; text: string }>;
  metadata?: {
    title?: string;
    author?: string;
  };
  needsOCR: boolean;
}

/**
 * Result of parsing an XLSX with sheet information
 */
interface XLSXParseResult {
  text: string;
  sheetCount: number;
  sheets: Array<{ name: string; text: string; rows: string[][] }>;
}

/**
 * Options for loading documents from a directory
 */
export interface LoadDirectoryOptions {
  /** Recursively scan subdirectories */
  recursive?: boolean;
  /** Filter by file types */
  fileTypes?: FileType[];
  /** Category to assign to documents */
  category?: string;
  /** Tags to assign to documents */
  tags?: string[];
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Load and parse a single document
 * @param filePath - Path to the document file
 * @returns Parsed document with metadata and content
 * @throws Error if file cannot be read or parsed
 */
export async function loadDocument(filePath: string): Promise<ParsedDocument> {
  const startTime = Date.now();
  const absolutePath = path.resolve(filePath);
  
  logger.info('Loading document', { filePath: absolutePath });

  // Validate file exists
  if (!fs.existsSync(absolutePath)) {
    const error = new Error(`File not found: ${absolutePath}`);
    logger.error('Document not found', { filePath: absolutePath });
    throw error;
  }

  // Get file stats
  const fileStats = await stat(absolutePath);
  if (!fileStats.isFile()) {
    const error = new Error(`Path is not a file: ${absolutePath}`);
    logger.error('Path is not a file', { filePath: absolutePath });
    throw error;
  }

  // Detect file type
  const fileType = detectFileType(absolutePath);
  const filename = path.basename(absolutePath);
  const documentId = `doc_${uuidv4()}`;
  const warnings: string[] = [];

  logger.debug('File type detected', { filePath: absolutePath, fileType });

  // Parse document based on type
  let content: string;
  let pageCount: number | undefined;
  let structure: ParsedDocument['structure'];
  let needsOCR = false;

  try {
    switch (fileType) {
      case 'pdf': {
        const pdfResult = await parsePDF(absolutePath);
        content = pdfResult.text;
        pageCount = pdfResult.pageCount;
        needsOCR = pdfResult.needsOCR;
        if (needsOCR) {
          warnings.push('PDF appears to be scanned/image-based. OCR processing recommended.');
        }
        break;
      }

      case 'docx': {
        const docxResult = await parseDOCX(absolutePath);
        content = docxResult.text;
        structure = docxResult.structure;
        break;
      }

      case 'xlsx': {
        const xlsxResult = await parseXLSX(absolutePath);
        content = xlsxResult.text;
        pageCount = xlsxResult.sheetCount;
        structure = {
          tables: xlsxResult.sheets.map((sheet, idx) => ({
            pageNumber: idx + 1,
            rows: sheet.rows,
          })),
        };
        break;
      }

      case 'txt':
      case 'csv': {
        content = await parsePlainText(absolutePath);
        break;
      }

      case 'image': {
        content = '';
        needsOCR = true;
        warnings.push('Image file detected. OCR processing required to extract text.');
        break;
      }

      default: {
        const error = new Error(`Unsupported file type: ${fileType}`);
        logger.error('Unsupported file type', { filePath: absolutePath, fileType });
        throw error;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to parse document', { 
      filePath: absolutePath, 
      fileType, 
      error: errorMessage 
    });
    throw new Error(`Failed to parse ${filename}: ${errorMessage}`);
  }

  // Generate content hash for deduplication
  const contentHash = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');

  // Build metadata
  const metadata: DocumentMetadata = {
    id: documentId,
    filename,
    filePath: absolutePath,
    fileType,
    sizeBytes: fileStats.size,
    pageCount,
    title: extractTitleFromFilename(filename),
    category: DOCUMENT_SOURCE,
    ingestedAt: new Date().toISOString(),
    lastModified: fileStats.mtime.toISOString(),
    contentHash,
  };

  // Build parsed document (chunks are empty - handled by chunker module)
  const parsedDocument: ParsedDocument = {
    metadata,
    content,
    chunks: [], // Chunking is handled separately
    structure,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  const duration = Date.now() - startTime;
  logger.info('Document loaded successfully', {
    documentId,
    filename,
    fileType,
    contentLength: content.length,
    pageCount,
    needsOCR,
    durationMs: duration,
  });

  return parsedDocument;
}

/**
 * Load all documents from a directory
 * @param directoryPath - Path to the directory
 * @param options - Loading options
 * @returns Array of parsed documents
 */
export async function loadAllDocuments(
  directoryPath: string,
  options: LoadDirectoryOptions = {}
): Promise<ParsedDocument[]> {
  const {
    recursive = true,
    fileTypes,
    category,
    tags,
  } = options;

  const absolutePath = path.resolve(directoryPath);
  const startTime = Date.now();

  logger.info('Loading documents from directory', {
    directoryPath: absolutePath,
    recursive,
    fileTypes,
  });

  // Validate directory exists
  if (!fs.existsSync(absolutePath)) {
    const error = new Error(`Directory not found: ${absolutePath}`);
    logger.error('Directory not found', { directoryPath: absolutePath });
    throw error;
  }

  const dirStats = await stat(absolutePath);
  if (!dirStats.isDirectory()) {
    const error = new Error(`Path is not a directory: ${absolutePath}`);
    logger.error('Path is not a directory', { directoryPath: absolutePath });
    throw error;
  }

  // Find all matching files
  const files = await findFiles(absolutePath, recursive, fileTypes);
  
  logger.info('Found files to process', { 
    directoryPath: absolutePath, 
    fileCount: files.length 
  });

  // Load each document
  const documents: ParsedDocument[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const filePath of files) {
    try {
      const doc = await loadDocument(filePath);
      
      // Apply custom category and tags if provided
      if (category) {
        doc.metadata.category = category;
      }
      if (tags) {
        doc.metadata.tags = tags;
      }
      
      documents.push(doc);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ file: filePath, error: errorMessage });
      logger.warn('Failed to load document, skipping', { 
        filePath, 
        error: errorMessage 
      });
    }
  }

  const duration = Date.now() - startTime;
  logger.info('Directory loading completed', {
    directoryPath: absolutePath,
    totalFiles: files.length,
    successCount: documents.length,
    errorCount: errors.length,
    durationMs: duration,
  });

  if (errors.length > 0) {
    logger.warn('Some documents failed to load', { errors });
  }

  return documents;
}

// ============================================================================
// File Type Detection
// ============================================================================

/**
 * Detect file type from extension
 * @param filePath - Path to the file
 * @returns Detected file type
 */
export function detectFileType(filePath: string): FileType {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS[ext] || 'unknown';
}

/**
 * Check if a file type is supported
 * @param filePath - Path to the file
 * @returns True if file type is supported
 */
export function isSupported(filePath: string): boolean {
  const fileType = detectFileType(filePath);
  return fileType !== 'unknown';
}

// ============================================================================
// Document Parsers
// ============================================================================

/**
 * Parse PDF document with page awareness
 * @param filePath - Path to PDF file
 * @returns Parsed PDF content and metadata
 */
async function parsePDF(filePath: string): Promise<PDFParseResult> {
  logger.debug('Parsing PDF', { filePath });

  const dataBuffer = await readFile(filePath);
  
  // Custom page render to track pages
  const pages: Array<{ pageNumber: number; text: string }> = [];
  let currentPage = 0;

  const options = {
    pagerender: async function(pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) {
      currentPage++;
      const textContent = await pageData.getTextContent();
      const pageText = textContent.items
        .map((item: { str: string }) => item.str)
        .join(' ');
      
      pages.push({
        pageNumber: currentPage,
        text: pageText,
      });
      
      return pageText;
    },
  };

  const pdfData = await pdfParse(dataBuffer, options);
  
  // Check if OCR might be needed (very little text extracted)
  const textDensity = pdfData.text.length / (pdfData.numpages || 1);
  const needsOCR = textDensity < 100; // Less than 100 chars per page suggests scanned

  return {
    text: pdfData.text.trim(),
    pageCount: pdfData.numpages,
    pages,
    metadata: {
      title: pdfData.info?.Title,
      author: pdfData.info?.Author,
    },
    needsOCR,
  };
}

/**
 * Parse DOCX document
 * @param filePath - Path to DOCX file
 * @returns Parsed DOCX content and structure
 */
async function parseDOCX(filePath: string): Promise<{
  text: string;
  structure?: ParsedDocument['structure'];
}> {
  logger.debug('Parsing DOCX', { filePath });

  const dataBuffer = await readFile(filePath);
  
  // Extract raw text
  const result = await mammoth.extractRawText({ buffer: dataBuffer });
  
  // Also try to extract with structure for headings
  const htmlResult = await mammoth.convertToHtml({ buffer: dataBuffer });
  
  // Extract headings from HTML
  const headings: Array<{ level: number; text: string }> = [];
  const headingRegex = /<h([1-6])[^>]*>([^<]*)<\/h\1>/gi;
  let match;
  
  while ((match = headingRegex.exec(htmlResult.value)) !== null) {
    headings.push({
      level: parseInt(match[1], 10),
      text: match[2].trim(),
    });
  }

  // Log any conversion warnings
  if (result.messages.length > 0) {
    logger.debug('DOCX parsing warnings', { 
      filePath, 
      warnings: result.messages.map(m => m.message) 
    });
  }

  return {
    text: result.value.trim(),
    structure: headings.length > 0 ? { headings } : undefined,
  };
}

/**
 * Parse XLSX/XLS document (sheet-based)
 * @param filePath - Path to Excel file
 * @returns Parsed Excel content with sheet information
 */
async function parseXLSX(filePath: string): Promise<XLSXParseResult> {
  logger.debug('Parsing XLSX', { filePath });

  const workbook = XLSX.readFile(filePath);
  const sheets: XLSXParseResult['sheets'] = [];
  const textParts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to array of arrays
    const rows: string[][] = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: '',
    }) as string[][];

    // Convert to text representation
    const sheetText = rows
      .map(row => row.join('\t'))
      .join('\n');

    sheets.push({
      name: sheetName,
      text: sheetText,
      rows,
    });

    textParts.push(`[Sheet: ${sheetName}]\n${sheetText}`);
  }

  logger.debug('XLSX parsed', { 
    filePath, 
    sheetCount: sheets.length,
    sheetNames: workbook.SheetNames,
  });

  return {
    text: textParts.join('\n\n'),
    sheetCount: sheets.length,
    sheets,
  };
}

/**
 * Parse plain text or CSV file
 * @param filePath - Path to text file
 * @returns File content as string
 */
async function parsePlainText(filePath: string): Promise<string> {
  logger.debug('Parsing plain text', { filePath });
  
  const content = await readFile(filePath, 'utf-8');
  return content.trim();
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find all supported files in a directory
 * @param dirPath - Directory to search
 * @param recursive - Search subdirectories
 * @param fileTypes - Filter by file types
 * @returns Array of file paths
 */
async function findFiles(
  dirPath: string,
  recursive: boolean,
  fileTypes?: FileType[]
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        const subFiles = await findFiles(fullPath, recursive, fileTypes);
        files.push(...subFiles);
      }
    } else if (entry.isFile()) {
      const fileType = detectFileType(fullPath);
      
      // Skip unsupported files
      if (fileType === 'unknown') continue;
      
      // Apply file type filter if specified
      if (fileTypes && !fileTypes.includes(fileType)) continue;
      
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract a title from filename
 * @param filename - Original filename
 * @returns Cleaned title
 */
function extractTitleFromFilename(filename: string): string {
  // Remove extension
  const nameWithoutExt = path.parse(filename).name;
  
  // Replace underscores and hyphens with spaces
  const cleaned = nameWithoutExt
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  return cleaned;
}

// ============================================================================
// Exports
// ============================================================================

export default {
  loadDocument,
  loadAllDocuments,
  detectFileType,
  isSupported,
};
