/**
 * OCR Service - Extracts text from scanned documents using Tesseract.js
 */
import Tesseract from 'tesseract.js';
import { logger } from './logger';
import { config } from '../config';

/**
 * OCR Service for extracting text from images and scanned PDFs
 */
export class OCRService {
  private languages: string;

  constructor() {
    this.languages = config.ocrLanguages;
    logger.info(`OCR Service initialized with languages: ${this.languages}`);
  }

  /**
   * Extract text from an image buffer using OCR
   * @param imageBuffer - Buffer containing the image data
   * @param pageNumber - Optional page number for logging
   * @returns Extracted text
   */
  async extractTextFromImage(imageBuffer: Buffer, pageNumber?: number): Promise<string> {
    const startTime = Date.now();
    const pageInfo = pageNumber ? ` (page ${pageNumber})` : '';
    
    try {
      logger.info(`Starting OCR extraction${pageInfo}`);
      
      const result = await Tesseract.recognize(imageBuffer, this.languages, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            logger.debug(`OCR progress${pageInfo}: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      const extractedText = result.data.text;
      const duration = Date.now() - startTime;
      
      logger.info(`OCR extraction completed${pageInfo}`, {
        textLength: extractedText.length,
        confidence: result.data.confidence,
        duration: `${duration}ms`
      });

      return extractedText;
    } catch (error) {
      logger.error(`OCR extraction failed${pageInfo}`, { error });
      throw new Error(`OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract text from multiple image buffers (e.g., multi-page PDF)
   * @param imageBuffers - Array of image buffers
   * @returns Combined extracted text
   */
  async extractTextFromImages(imageBuffers: Buffer[]): Promise<string> {
    logger.info(`Starting OCR extraction for ${imageBuffers.length} images`);
    
    const texts: string[] = [];
    
    for (let i = 0; i < imageBuffers.length; i++) {
      const text = await this.extractTextFromImage(imageBuffers[i], i + 1);
      texts.push(text);
    }

    const combinedText = texts.join('\n\n--- Page Break ---\n\n');
    
    logger.info('OCR extraction completed for all images', {
      totalPages: imageBuffers.length,
      totalLength: combinedText.length
    });

    return combinedText;
  }

  /**
   * Check if a PDF appears to be scanned (low text content)
   * This is a heuristic check - if text extraction yields very little text,
   * it's likely a scanned PDF
   * @param extractedText - Text extracted from PDF
   * @param pageCount - Number of pages in PDF
   * @returns True if PDF appears to be scanned
   */
  isScannedPDF(extractedText: string, pageCount: number): boolean {
    const textLength = extractedText.trim().length;
    const avgCharsPerPage = textLength / pageCount;
    
    // If average is less than 50 chars per page, likely scanned
    const isScanned = avgCharsPerPage < 50;
    
    logger.debug('Scanned PDF detection', {
      textLength,
      pageCount,
      avgCharsPerPage,
      isScanned
    });
    
    return isScanned;
  }
}

// Singleton instance
export const ocrService = new OCRService();
export default ocrService;
