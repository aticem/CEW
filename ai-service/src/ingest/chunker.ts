/**
 * Text Chunker - Splits documents into chunks for embedding
 */
import { v4 as uuidv4 } from 'uuid';
import { DocumentChunk, ParsedDocument } from '../types';
import { logger } from '../services/logger';
import { config } from '../config';

/**
 * Text Chunker class - handles intelligent text splitting
 */
export class TextChunker {
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(chunkSize?: number, chunkOverlap?: number) {
    this.chunkSize = chunkSize || config.chunkSize;
    this.chunkOverlap = chunkOverlap || config.chunkOverlap;
    
    logger.info(`Text Chunker initialized`, {
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap
    });
  }

  /**
   * Split a parsed document into chunks
   * @param document - The parsed document
   * @returns Array of document chunks
   */
  chunkDocument(document: ParsedDocument): DocumentChunk[] {
    const startTime = Date.now();
    logger.info(`Chunking document: ${document.metadata.filename}`);

    const text = document.text;
    if (!text || text.trim().length === 0) {
      logger.warn(`Document has no text content: ${document.metadata.filename}`);
      return [];
    }

    // Split text into chunks
    const chunks = this.splitText(text);
    
    // Create DocumentChunk objects
    const documentChunks: DocumentChunk[] = chunks.map((chunk, _index) => ({
      id: uuidv4(),
      documentId: document.metadata.id,
      content: chunk.text,
      startIndex: chunk.start,
      endIndex: chunk.end,
      pageNumber: this.estimatePageNumber(chunk.start, text, document.pageCount),
      metadata: document.metadata
    }));

    const duration = Date.now() - startTime;
    logger.info(`Document chunked successfully`, {
      filename: document.metadata.filename,
      totalChunks: documentChunks.length,
      avgChunkSize: Math.round(text.length / documentChunks.length),
      duration: `${duration}ms`
    });

    return documentChunks;
  }

  /**
   * Split text into overlapping chunks
   * @param text - The text to split
   * @returns Array of text chunks with position info
   */
  private splitText(text: string): Array<{ text: string; start: number; end: number }> {
    const chunks: Array<{ text: string; start: number; end: number }> = [];
    
    // Normalize whitespace
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    
    let startIndex = 0;
    
    while (startIndex < normalizedText.length) {
      // Calculate end index for this chunk
      let endIndex = Math.min(startIndex + this.chunkSize, normalizedText.length);
      
      // If not at the end, try to break at sentence or word boundary
      if (endIndex < normalizedText.length) {
        endIndex = this.findBoundary(normalizedText, endIndex);
      }
      
      // Extract chunk text
      const chunkText = normalizedText.substring(startIndex, endIndex).trim();
      
      if (chunkText.length > 0) {
        chunks.push({
          text: chunkText,
          start: startIndex,
          end: endIndex
        });
      }
      
      // Move to next chunk with overlap
      startIndex = endIndex - this.chunkOverlap;
      
      // Ensure we make progress
      if (startIndex <= chunks[chunks.length - 1]?.start) {
        startIndex = endIndex;
      }
    }
    
    return chunks;
  }

  /**
   * Find a good boundary to split at (sentence or word)
   * @param text - The text to search
   * @param position - Starting position to search from
   * @returns Adjusted boundary position
   */
  private findBoundary(text: string, position: number): number {
    // Look back up to 200 characters for a good break point
    const lookbackDistance = Math.min(200, position);
    const searchStart = position - lookbackDistance;
    const searchText = text.substring(searchStart, position + 50);
    
    // Try to find sentence endings first
    const sentenceEndings = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    let bestBoundary = -1;
    let bestScore = -1;
    
    for (const ending of sentenceEndings) {
      const lastIndex = searchText.lastIndexOf(ending);
      if (lastIndex !== -1) {
        const absoluteIndex = searchStart + lastIndex + ending.length;
        const distance = Math.abs(absoluteIndex - position);
        const score = 1000 - distance; // Prefer closer to target position
        
        if (score > bestScore && absoluteIndex <= position) {
          bestScore = score;
          bestBoundary = absoluteIndex;
        }
      }
    }
    
    if (bestBoundary !== -1) {
      return bestBoundary;
    }
    
    // If no sentence boundary found, try paragraph breaks
    const paragraphBreak = searchText.lastIndexOf('\n\n');
    if (paragraphBreak !== -1) {
      const absoluteIndex = searchStart + paragraphBreak + 2;
      if (absoluteIndex <= position) {
        return absoluteIndex;
      }
    }
    
    // Try line breaks
    const lineBreak = searchText.lastIndexOf('\n');
    if (lineBreak !== -1) {
      const absoluteIndex = searchStart + lineBreak + 1;
      if (absoluteIndex <= position) {
        return absoluteIndex;
      }
    }
    
    // Fall back to word boundary
    const wordBreak = searchText.lastIndexOf(' ');
    if (wordBreak !== -1) {
      const absoluteIndex = searchStart + wordBreak + 1;
      if (absoluteIndex <= position) {
        return absoluteIndex;
      }
    }
    
    // Last resort: use the original position
    return position;
  }

  /**
   * Estimate page number based on character position
   * @param position - Character position in text
   * @param totalText - Full text content
   * @param pageCount - Total number of pages
   * @returns Estimated page number
   */
  private estimatePageNumber(
    position: number,
    totalText: string,
    pageCount?: number
  ): number | undefined {
    if (!pageCount || pageCount <= 1) {
      return undefined;
    }
    
    // Simple estimation: assume uniform text distribution
    const progress = position / totalText.length;
    return Math.min(Math.ceil(progress * pageCount), pageCount);
  }

  /**
   * Update chunk size configuration
   */
  setChunkSize(size: number): void {
    this.chunkSize = size;
    logger.info(`Chunk size updated to ${size}`);
  }

  /**
   * Update chunk overlap configuration
   */
  setChunkOverlap(overlap: number): void {
    this.chunkOverlap = overlap;
    logger.info(`Chunk overlap updated to ${overlap}`);
  }
}

// Singleton instance
export const textChunker = new TextChunker();
export default textChunker;
