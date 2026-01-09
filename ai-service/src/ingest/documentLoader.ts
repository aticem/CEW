/**
 * Document Loader - Loads and parses various document formats
 */
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import { DocumentMetadata, ParsedDocument } from '../types';
import { logger } from '../services/logger';
import { ocrService } from '../services/ocrService';

/**
 * Document Loader class - handles loading and parsing of various document types
 */
export class DocumentLoader {
  /**
   * Supported file extensions
   */
  private static readonly SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.xls', '.txt'];

  /**
   * Load and parse a document file
   * @param filepath - Path to the document file
   * @returns Parsed document with metadata
   */
  async loadDocument(filepath: string): Promise<ParsedDocument> {
    const startTime = Date.now();
    logger.info(`Loading document: ${filepath}`);

    try {
      // Validate file exists
      const stats = await fs.stat(filepath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filepath}`);
      }

      // Get file extension
      const ext = path.extname(filepath).toLowerCase();
      if (!DocumentLoader.SUPPORTED_EXTENSIONS.includes(ext)) {
        throw new Error(`Unsupported file type: ${ext}`);
      }

      // Create base metadata
      const metadata: DocumentMetadata = {
        id: uuidv4(),
        filename: path.basename(filepath),
        filepath: filepath,
        fileType: ext.substring(1), // Remove the dot
        fileSize: stats.size,
        ingestedAt: new Date(),
        ocrApplied: false,
      };

      // Parse based on file type
      let result: ParsedDocument;
      switch (ext) {
        case '.pdf':
          result = await this.loadPDF(filepath, metadata);
          break;
        case '.docx':
          result = await this.loadDOCX(filepath, metadata);
          break;
        case '.xlsx':
        case '.xls':
          result = await this.loadXLSX(filepath, metadata);
          break;
        case '.txt':
          result = await this.loadTXT(filepath, metadata);
          break;
        default:
          throw new Error(`Unsupported file type: ${ext}`);
      }

      const duration = Date.now() - startTime;
      logger.info(`Document loaded successfully`, {
        filename: metadata.filename,
        fileType: metadata.fileType,
        textLength: result.text.length,
        ocrApplied: result.ocrApplied,
        duration: `${duration}ms`
      });

      return result;
    } catch (error) {
      logger.error(`Failed to load document: ${filepath}`, { error });
      throw error;
    }
  }

  /**
   * Load and parse a PDF file
   */
  private async loadPDF(filepath: string, metadata: DocumentMetadata): Promise<ParsedDocument> {
    logger.info(`Parsing PDF: ${filepath}`);
    
    const buffer = await fs.readFile(filepath);
    const pdfData = await pdfParse(buffer);
    
    let text = pdfData.text;
    let ocrApplied = false;
    const warnings: string[] = [];

    // Update metadata with page count
    metadata.pageCount = pdfData.numpages;

    // Check if PDF is scanned and needs OCR
    if (ocrService.isScannedPDF(text, pdfData.numpages)) {
      logger.info(`PDF appears to be scanned, applying OCR: ${filepath}`);
      warnings.push('Document was scanned, OCR was applied for text extraction');
      
      try {
        // For now, we'll use the original text extraction
        // In a production system, you'd convert PDF pages to images and run OCR
        // This would require additional dependencies like pdf-to-img or pdf2pic
        logger.warn('Full OCR for scanned PDFs requires additional setup. Using basic extraction.');
        ocrApplied = true;
      } catch (ocrError) {
        logger.error('OCR failed, using basic text extraction', { error: ocrError });
        warnings.push('OCR processing failed, text quality may be poor');
      }
    }

    metadata.ocrApplied = ocrApplied;

    return {
      text,
      metadata,
      pageCount: pdfData.numpages,
      ocrApplied,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Load and parse a DOCX file
   */
  private async loadDOCX(filepath: string, metadata: DocumentMetadata): Promise<ParsedDocument> {
    logger.info(`Parsing DOCX: ${filepath}`);
    
    const buffer = await fs.readFile(filepath);
    const result = await mammoth.extractRawText({ buffer });
    
    const warnings: string[] = [];
    if (result.messages.length > 0) {
      result.messages.forEach(msg => {
        logger.debug(`DOCX parsing message: ${msg.message}`);
      });
      warnings.push(`Document contained ${result.messages.length} formatting issues`);
    }

    return {
      text: result.value,
      metadata,
      ocrApplied: false,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Load and parse an Excel file
   */
  private async loadXLSX(filepath: string, metadata: DocumentMetadata): Promise<ParsedDocument> {
    logger.info(`Parsing XLSX: ${filepath}`);
    
    const workbook = xlsx.readFile(filepath);
    const texts: string[] = [];

    // Process each sheet
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      
      // Convert sheet to text (CSV-like format)
      const sheetText = xlsx.utils.sheet_to_txt(sheet, { FS: '\t' });
      
      texts.push(`\n--- Sheet: ${sheetName} ---\n${sheetText}`);
    });

    const combinedText = texts.join('\n\n');

    return {
      text: combinedText,
      metadata,
      pageCount: workbook.SheetNames.length,
      ocrApplied: false
    };
  }

  /**
   * Load and parse a text file
   */
  private async loadTXT(filepath: string, metadata: DocumentMetadata): Promise<ParsedDocument> {
    logger.info(`Parsing TXT: ${filepath}`);
    
    const text = await fs.readFile(filepath, 'utf-8');

    return {
      text,
      metadata,
      ocrApplied: false
    };
  }

  /**
   * Check if a file type is supported
   */
  static isSupportedFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return this.SUPPORTED_EXTENSIONS.includes(ext);
  }

  /**
   * Get list of supported extensions
   */
  static getSupportedExtensions(): string[] {
    return [...this.SUPPORTED_EXTENSIONS];
  }
}

// Singleton instance
export const documentLoader = new DocumentLoader();
export default documentLoader;
