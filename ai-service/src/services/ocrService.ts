import { createWorker, createScheduler, Worker, Scheduler } from 'tesseract.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  ParsedDocument,
  DocumentMetadata,
  DocumentChunk,
  ChunkMetadata,
} from '../types';
import { logger } from './logger';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of OCR processing for a single page
 */
export interface OCRPageResult {
  /** Page number (1-indexed) */
  pageNumber: number;
  /** Extracted text content */
  text: string;
  /** OCR confidence score (0-100) */
  confidence: number;
}

/**
 * Result of OCR processing for an entire document
 */
export interface OCRResult {
  /** Results for each page */
  pages: OCRPageResult[];
  /** Average confidence across all pages */
  averageConfidence: number;
  /** Total processing time in milliseconds */
  processingTimeMs: number;
}

/**
 * Extended metadata for OCR-processed documents
 */
export interface OCRDocumentMetadata extends DocumentMetadata {
  /** Whether OCR was performed on this document */
  ocrProcessed: boolean;
  /** Average OCR confidence (0-100) */
  ocrConfidence?: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Minimum characters per page to consider text extraction successful */
const OCR_TEXT_THRESHOLD = 100;

/** Supported languages for OCR (Tesseract language codes) */
const OCR_LANGUAGES = {
  turkish: 'tur',
  english: 'eng',
  combined: 'tur+eng',
};

/** Default language configuration for OCR */
const DEFAULT_OCR_LANG = OCR_LANGUAGES.combined;

// =============================================================================
// OCR Service Class
// =============================================================================

/**
 * Service for performing OCR on scanned documents and images
 * Uses Tesseract.js for text extraction with Turkish and English support
 *
 * Note: PDF OCR requires converting PDF pages to images first.
 * For direct image files (PNG, JPG, TIFF), use processImageFile() or performOCROnImages().
 */
class OCRService {
  private scheduler: Scheduler | null = null;
  private workers: Worker[] = [];
  private initialized: boolean = false;
  private workerCount: number = 2; // Number of parallel workers

  /**
   * Initialize the OCR service with Tesseract workers
   * Configures for Turkish + English language support
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const startTime = Date.now();

    try {
      logger.info('Initializing OCR service...', {
        languages: DEFAULT_OCR_LANG,
        workerCount: this.workerCount,
      });

      this.scheduler = createScheduler();

      // Create workers for parallel processing
      for (let i = 0; i < this.workerCount; i++) {
        const worker = await createWorker(DEFAULT_OCR_LANG, 1, {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              logger.debug('OCR progress', {
                workerId: i,
                progress: Math.round(m.progress * 100)
              });
            }
          },
        });

        this.workers.push(worker);
        this.scheduler.addWorker(worker);
      }

      this.initialized = true;

      const initTime = Date.now() - startTime;
      logger.info('OCR service initialized successfully', {
        initTimeMs: initTime,
        languages: DEFAULT_OCR_LANG,
      });
    } catch (error) {
      logger.error('Failed to initialize OCR service', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`OCR initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if a PDF document needs OCR processing
   * Based on the amount of extracted text relative to page count
   *
   * @param pdfContent - Text content extracted from PDF
   * @param pageCount - Number of pages in the PDF
   * @returns True if OCR is recommended
   *
   * @example
   * ```typescript
   * const needsProcessing = ocrService.needsOCR(extractedText, 10);
   * if (needsProcessing) {
   *   // Convert PDF to images and process with OCR
   * }
   * ```
   */
  needsOCR(pdfContent: string, pageCount: number): boolean {
    if (pageCount <= 0) {
      return false;
    }

    const avgCharsPerPage = pdfContent.length / pageCount;
    const needsOcr = avgCharsPerPage < OCR_TEXT_THRESHOLD;

    logger.debug('OCR need assessment', {
      totalChars: pdfContent.length,
      pageCount,
      avgCharsPerPage: Math.round(avgCharsPerPage),
      threshold: OCR_TEXT_THRESHOLD,
      needsOCR: needsOcr,
    });

    return needsOcr;
  }

  /**
   * Perform OCR on a PDF buffer
   * Converts PDF pages to images and extracts text using Tesseract
   *
   * @param pdfBuffer - Buffer containing PDF data
   * @returns OCR result with page-by-page text and confidence scores
   * @throws Error if PDF to image conversion is not available
   *
   * @example
   * ```typescript
   * const buffer = await fs.readFile('scanned-document.pdf');
   * const result = await ocrService.performOCR(buffer);
   * console.log(`Average confidence: ${result.averageConfidence}%`);
   * ```
   */
  async performOCR(pdfBuffer: Buffer): Promise<OCRResult> {
    await this.initialize();

    const startTime = Date.now();

    try {
      // Try to convert PDF to images
      logger.info('Converting PDF to images for OCR...');
      const images = await this.convertPDFToImages(pdfBuffer);

      return await this.performOCROnImages(images);
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      logger.error('OCR processing failed', {
        error: error instanceof Error ? error.message : String(error),
        processingTimeMs,
      });
      throw error;
    }
  }

  /**
   * Perform OCR on an array of image buffers
   *
   * @param images - Array of image buffers (PNG, JPG, etc.)
   * @returns OCR result with page-by-page text and confidence scores
   */
  async performOCROnImages(images: Buffer[] | Uint8Array[]): Promise<OCRResult> {
    await this.initialize();

    const startTime = Date.now();
    const pages: OCRPageResult[] = [];

    logger.info(`Processing ${images.length} images with OCR...`, {
      imageCount: images.length,
    });

    // Process each image
    for (let i = 0; i < images.length; i++) {
      const pageStartTime = Date.now();
      const pageResult = await this.processImageBuffer(images[i], i + 1);
      const pageTime = Date.now() - pageStartTime;

      pages.push(pageResult);

      logger.debug('Page OCR completed', {
        pageNumber: i + 1,
        confidence: Math.round(pageResult.confidence),
        textLength: pageResult.text.length,
        processingTimeMs: pageTime,
      });
    }

    // Calculate average confidence
    const totalConfidence = pages.reduce((sum, p) => sum + p.confidence, 0);
    const averageConfidence = pages.length > 0 ? totalConfidence / pages.length : 0;

    const processingTimeMs = Date.now() - startTime;

    logger.info('OCR processing completed', {
      pageCount: pages.length,
      averageConfidence: Math.round(averageConfidence),
      totalTextLength: pages.reduce((sum, p) => sum + p.text.length, 0),
      processingTimeMs,
    });

    return {
      pages,
      averageConfidence,
      processingTimeMs,
    };
  }

  /**
   * Process a document file with OCR if needed
   * Loads the PDF, checks if OCR is needed, and returns parsed document
   *
   * @param filePath - Path to the PDF file
   * @returns Parsed document with OCR metadata
   *
   * @example
   * ```typescript
   * const doc = await ocrService.processDocumentWithOCR('./scanned.pdf');
   * if (doc.metadata.ocrProcessed) {
   *   console.log(`OCR confidence: ${doc.metadata.ocrConfidence}%`);
   * }
   * ```
   */
  async processDocumentWithOCR(filePath: string): Promise<ParsedDocument> {
    const startTime = Date.now();
    const absolutePath = path.resolve(filePath);

    logger.info('Processing document with OCR check', { filePath: absolutePath });

    // Read the PDF file
    const pdfBuffer = await fs.readFile(absolutePath);

    // Try to extract text first using pdf-parse
    const pdfParse = await import('pdf-parse');
    const pdfData = await pdfParse.default(pdfBuffer);

    // Create base metadata
    const metadata: OCRDocumentMetadata = {
      id: uuidv4(),
      filename: path.basename(absolutePath),
      source: 'local_documents',
      logicalPath: '/',
      filetype: 'pdf',
      createdAt: new Date(),
      updatedAt: new Date(),
      pageCount: pdfData.numpages,
      ocrProcessed: false,
    };

    let chunks: DocumentChunk[];

    // Check if OCR is needed
    if (this.needsOCR(pdfData.text, pdfData.numpages)) {
      logger.info('Document requires OCR processing', {
        documentId: metadata.id,
        filename: metadata.filename,
        pageCount: pdfData.numpages,
      });

      try {
        // Perform OCR
        const ocrResult = await this.performOCR(pdfBuffer);

        metadata.ocrProcessed = true;
        metadata.ocrConfidence = ocrResult.averageConfidence;

        // Create chunks from OCR results
        chunks = ocrResult.pages.map((page, index) => {
          const chunkMetadata: ChunkMetadata = {
            pageNumber: page.pageNumber,
            chunkIndex: index,
            startOffset: 0,
            endOffset: page.text.length,
          };

          return {
            id: uuidv4(),
            documentId: metadata.id,
            content: page.text,
            metadata: chunkMetadata,
            embedding: [],
          };
        });
      } catch (ocrError) {
        // OCR failed, fall back to whatever text we have
        logger.warn('OCR processing failed, using extracted text', {
          documentId: metadata.id,
          error: ocrError instanceof Error ? ocrError.message : String(ocrError),
        });

        chunks = this.createChunksFromText(pdfData.text, metadata.id);
      }
    } else {
      logger.info('Document has sufficient text, skipping OCR', {
        documentId: metadata.id,
        filename: metadata.filename,
        textLength: pdfData.text.length,
      });

      chunks = this.createChunksFromText(pdfData.text, metadata.id);
    }

    const processingTime = Date.now() - startTime;

    logger.info('Document processing completed', {
      documentId: metadata.id,
      filename: metadata.filename,
      ocrProcessed: metadata.ocrProcessed,
      ocrConfidence: metadata.ocrConfidence,
      chunksCreated: chunks.length,
      processingTimeMs: processingTime,
    });

    return {
      metadata,
      chunks,
    };
  }

  /**
   * Process a single image buffer with OCR
   */
  private async processImageBuffer(
    imageBuffer: Buffer | Uint8Array,
    pageNumber: number
  ): Promise<OCRPageResult> {
    if (!this.scheduler) {
      throw new Error('OCR service not initialized');
    }

    const result = await this.scheduler.addJob('recognize', imageBuffer);

    return {
      pageNumber,
      text: result.data.text.trim(),
      confidence: result.data.confidence,
    };
  }

  /**
   * Convert PDF buffer to array of page images
   * Uses dynamic import to check for available PDF conversion libraries
   */
  private async convertPDFToImages(pdfBuffer: Buffer): Promise<Uint8Array[]> {
    // Try pdf-img-convert first (if installed)
    try {
      const pdfImgConvert = await import('pdf-img-convert');
      const images = await pdfImgConvert.convert(pdfBuffer, {
        width: 2000,
        height: 2000,
        base64: false,
      });
      return images as Uint8Array[];
    } catch (importError) {
      // pdf-img-convert not available
    }

    // If no PDF conversion library is available, throw helpful error
    throw new Error(
      'PDF to image conversion is not available. ' +
      'For PDF OCR support, you need to either:\n' +
      '1. Install pdf-img-convert: npm install pdf-img-convert (requires native build tools)\n' +
      '2. Pre-convert PDF pages to images and use performOCROnImages()\n' +
      '3. Use an external service to convert PDFs to images'
    );
  }

  /**
   * Create chunks from text content
   */
  private createChunksFromText(text: string, documentId: string): DocumentChunk[] {
    const pageTexts = text.split('\f');

    return pageTexts
      .filter((pageText) => pageText.trim().length > 0)
      .map((pageText, index) => {
        const trimmedText = pageText.trim();
        const chunkMetadata: ChunkMetadata = {
          pageNumber: index + 1,
          chunkIndex: index,
          startOffset: 0,
          endOffset: trimmedText.length,
        };

        return {
          id: uuidv4(),
          documentId,
          content: trimmedText,
          metadata: chunkMetadata,
          embedding: [],
        };
      });
  }

  /**
   * Detect the primary language of text content
   * Returns language hint for OCR optimization
   *
   * @param text - Sample text to analyze
   * @returns Tesseract language code
   */
  detectLanguageHint(text: string): string {
    // Turkish-specific characters
    const turkishChars = /[çÇğĞıİöÖşŞüÜ]/;
    const hasTurkish = turkishChars.test(text);

    // Check for common Turkish words
    const turkishWords = /\b(ve|bir|için|bu|ile|olan|de|da|den|dan|mi|mı|mu|mü)\b/i;
    const hasTurkishWords = turkishWords.test(text);

    if (hasTurkish || hasTurkishWords) {
      logger.debug('Detected Turkish language hints');
      return OCR_LANGUAGES.turkish;
    }

    // Default to combined for best coverage
    return OCR_LANGUAGES.combined;
  }

  /**
   * Process an image file with OCR
   *
   * @param imagePath - Path to image file (PNG, JPG, TIFF, BMP, etc.)
   * @returns OCR result for the image
   *
   * @example
   * ```typescript
   * const result = await ocrService.processImageFile('./scanned-page.png');
   * console.log(result.text);
   * console.log(`Confidence: ${result.confidence}%`);
   * ```
   */
  async processImageFile(imagePath: string): Promise<OCRPageResult> {
    await this.initialize();

    const startTime = Date.now();
    const absolutePath = path.resolve(imagePath);

    try {
      const imageBuffer = await fs.readFile(absolutePath);
      const result = await this.processImageBuffer(imageBuffer, 1);

      const processingTime = Date.now() - startTime;

      logger.info('Image OCR completed', {
        filePath: absolutePath,
        confidence: Math.round(result.confidence),
        textLength: result.text.length,
        processingTimeMs: processingTime,
      });

      return result;
    } catch (error) {
      logger.error('Image OCR failed', {
        filePath: absolutePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Process multiple image files with OCR
   *
   * @param imagePaths - Array of paths to image files
   * @returns OCR result with all pages
   */
  async processImageFiles(imagePaths: string[]): Promise<OCRResult> {
    const images: Buffer[] = [];

    for (const imagePath of imagePaths) {
      const buffer = await fs.readFile(path.resolve(imagePath));
      images.push(buffer);
    }

    return this.performOCROnImages(images);
  }

  /**
   * Terminate OCR workers and release resources
   */
  async terminate(): Promise<void> {
    if (this.scheduler) {
      await this.scheduler.terminate();
      this.scheduler = null;
    }

    for (const worker of this.workers) {
      await worker.terminate();
    }
    this.workers = [];
    this.initialized = false;

    logger.info('OCR service terminated');
  }

  /**
   * Check if the OCR service is healthy and operational
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.initialize();
      return this.initialized && this.scheduler !== null;
    } catch {
      return false;
    }
  }

  /**
   * Check if the OCR service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the OCR text threshold
   */
  getTextThreshold(): number {
    return OCR_TEXT_THRESHOLD;
  }

  /**
   * Get supported OCR languages
   */
  getSupportedLanguages(): Record<string, string> {
    return { ...OCR_LANGUAGES };
  }
}

// =============================================================================
// Export singleton instance
// =============================================================================

export const ocrService = new OCRService();

export default ocrService;
