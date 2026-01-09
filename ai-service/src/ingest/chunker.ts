/**
 * Document Chunker Module
 * @module ingest/chunker
 * 
 * Splits documents into semantic chunks for embedding and retrieval.
 * Respects paragraph/page boundaries and avoids splitting mid-sentence.
 */

import { v4 as uuidv4 } from 'uuid';
import { DocumentChunk, ParsedDocument } from '../types';
import { config } from '../config';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for chunking documents
 */
export interface ChunkingOptions {
  /** Maximum characters per chunk */
  chunkSize: number;
  /** Overlap between consecutive chunks */
  chunkOverlap: number;
  /** Separators in order of priority (paragraph, line, sentence, word) */
  separators: string[];
  /** Minimum chunk size (chunks smaller than this get merged) */
  minChunkSize: number;
  /** Preserve heading context in chunks */
  preserveHeadings: boolean;
}

/**
 * Statistics from chunking operation
 */
export interface ChunkingStats {
  documentId: string;
  filename: string;
  totalChunks: number;
  avgChunkSize: number;
  minChunkSize: number;
  maxChunkSize: number;
  totalCharacters: number;
  processingTimeMs: number;
}

/**
 * Internal representation of text with position tracking
 */
interface TextSegment {
  text: string;
  startOffset: number;
  endOffset: number;
  pageNumber?: number;
  headings?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/** Default chunking options */
const DEFAULT_OPTIONS: ChunkingOptions = {
  chunkSize: config.chunking.chunkSize,
  chunkOverlap: config.chunking.chunkOverlap,
  separators: [
    '\n\n\n',    // Multiple blank lines (section breaks)
    '\n\n',      // Paragraph breaks
    '\n',        // Line breaks
    '. ',        // Sentence endings
    '? ',        // Question marks
    '! ',        // Exclamation marks
    '; ',        // Semicolons
    ', ',        // Commas
    ' ',         // Words
  ],
  minChunkSize: 100,
  preserveHeadings: true,
};

/** Sentence ending patterns */
const SENTENCE_ENDINGS = /[.!?]\s+/;

/** Page marker pattern (e.g., [Page 1], --- Page 2 ---) */
const PAGE_MARKER_PATTERN = /\[Page\s+(\d+)\]|---\s*Page\s+(\d+)\s*---/gi;

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Chunk a single parsed document
 * @param document - Parsed document to chunk
 * @param options - Chunking options (uses config defaults if not provided)
 * @returns Document with chunks array populated
 */
export function chunkDocument(
  document: ParsedDocument,
  options: Partial<ChunkingOptions> = {}
): ParsedDocument {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  logger.debug('Starting document chunking', {
    documentId: document.metadata.id,
    filename: document.metadata.filename,
    contentLength: document.content.length,
    chunkSize: opts.chunkSize,
    chunkOverlap: opts.chunkOverlap,
  });

  // Handle empty content
  if (!document.content || document.content.trim().length === 0) {
    logger.warn('Document has no content to chunk', {
      documentId: document.metadata.id,
    });
    return { ...document, chunks: [] };
  }

  // Extract headings for context
  const headings = document.structure?.headings || extractHeadings(document.content);
  
  // Split content into page-aware segments if possible
  const segments = splitByPages(document.content, document.metadata.pageCount);
  
  // Chunk each segment
  const chunks: DocumentChunk[] = [];
  let globalChunkIndex = 0;

  for (const segment of segments) {
    // Get applicable headings for this segment
    const segmentHeadings = opts.preserveHeadings
      ? findApplicableHeadings(headings, segment.pageNumber)
      : undefined;

    // Recursively split the segment
    const textChunks = recursiveSplit(
      segment.text,
      opts.separators,
      opts.chunkSize,
      opts.minChunkSize
    );

    // Create DocumentChunk objects with overlap
    let currentOffset = segment.startOffset;

    for (let i = 0; i < textChunks.length; i++) {
      const chunkText = textChunks[i];
      const chunkId = `chunk_${document.metadata.id}_${globalChunkIndex}`;
      
      // Calculate overlap text from previous chunk
      let finalText = chunkText;
      if (i > 0 && opts.chunkOverlap > 0) {
        const prevChunk = textChunks[i - 1];
        const overlapText = getOverlapText(prevChunk, opts.chunkOverlap);
        if (overlapText) {
          finalText = overlapText + chunkText;
        }
      }

      const chunk: DocumentChunk = {
        id: chunkId,
        documentId: document.metadata.id,
        content: finalText.trim(),
        chunkIndex: globalChunkIndex,
        pageNumber: segment.pageNumber,
        startOffset: currentOffset,
        endOffset: currentOffset + chunkText.length,
        headings: segmentHeadings,
      };

      chunks.push(chunk);
      currentOffset += chunkText.length;
      globalChunkIndex++;
    }
  }

  // Merge very small chunks
  const mergedChunks = mergeSmallChunks(chunks, opts.minChunkSize);

  // Calculate and log statistics
  const stats = calculateStats(document, mergedChunks, startTime);
  logChunkingStats(stats);

  return {
    ...document,
    chunks: mergedChunks,
  };
}

/**
 * Chunk multiple documents
 * @param documents - Array of parsed documents
 * @param options - Chunking options
 * @returns Array of documents with chunks populated
 */
export function chunkAllDocuments(
  documents: ParsedDocument[],
  options: Partial<ChunkingOptions> = {}
): ParsedDocument[] {
  const startTime = Date.now();
  
  logger.info('Starting batch document chunking', {
    documentCount: documents.length,
  });

  const chunkedDocuments: ParsedDocument[] = [];
  let totalChunks = 0;
  let errorCount = 0;

  for (const doc of documents) {
    try {
      const chunkedDoc = chunkDocument(doc, options);
      chunkedDocuments.push(chunkedDoc);
      totalChunks += chunkedDoc.chunks.length;
    } catch (error) {
      errorCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to chunk document', {
        documentId: doc.metadata.id,
        filename: doc.metadata.filename,
        error: errorMessage,
      });
      // Include document with empty chunks
      chunkedDocuments.push({ ...doc, chunks: [] });
    }
  }

  const duration = Date.now() - startTime;
  logger.info('Batch chunking completed', {
    documentCount: documents.length,
    totalChunks,
    errorCount,
    durationMs: duration,
    avgChunksPerDoc: documents.length > 0 
      ? (totalChunks / documents.length).toFixed(1) 
      : 0,
  });

  return chunkedDocuments;
}

// ============================================================================
// Splitting Functions
// ============================================================================

/**
 * Split content by page markers or estimated page boundaries
 */
function splitByPages(content: string, pageCount?: number): TextSegment[] {
  const segments: TextSegment[] = [];
  
  // Try to find page markers in content
  const pageMarkers: Array<{ index: number; pageNumber: number }> = [];
  let match;
  
  PAGE_MARKER_PATTERN.lastIndex = 0;
  while ((match = PAGE_MARKER_PATTERN.exec(content)) !== null) {
    const pageNum = parseInt(match[1] || match[2], 10);
    pageMarkers.push({ index: match.index, pageNumber: pageNum });
  }

  // If page markers found, split by them
  if (pageMarkers.length > 0) {
    for (let i = 0; i < pageMarkers.length; i++) {
      const start = pageMarkers[i].index;
      const end = i < pageMarkers.length - 1 
        ? pageMarkers[i + 1].index 
        : content.length;
      
      const text = content.slice(start, end)
        .replace(PAGE_MARKER_PATTERN, '')
        .trim();

      if (text.length > 0) {
        segments.push({
          text,
          startOffset: start,
          endOffset: end,
          pageNumber: pageMarkers[i].pageNumber,
        });
      }
    }
    return segments;
  }

  // If no markers but we know page count, estimate page boundaries
  if (pageCount && pageCount > 1) {
    const charsPerPage = Math.ceil(content.length / pageCount);
    
    for (let page = 1; page <= pageCount; page++) {
      const start = (page - 1) * charsPerPage;
      const end = Math.min(page * charsPerPage, content.length);
      
      // Try to break at paragraph boundary
      let adjustedEnd = end;
      if (end < content.length) {
        const nextParagraph = content.indexOf('\n\n', end - 100);
        if (nextParagraph > 0 && nextParagraph < end + 200) {
          adjustedEnd = nextParagraph;
        }
      }

      const text = content.slice(start, adjustedEnd).trim();
      if (text.length > 0) {
        segments.push({
          text,
          startOffset: start,
          endOffset: adjustedEnd,
          pageNumber: page,
        });
      }
    }
    return segments;
  }

  // Single segment for entire content
  return [{
    text: content,
    startOffset: 0,
    endOffset: content.length,
    pageNumber: 1,
  }];
}

/**
 * Recursively split text using separators in order of priority
 * Avoids splitting mid-sentence when possible
 */
export function recursiveSplit(
  text: string,
  separators: string[],
  maxSize: number,
  minSize: number
): string[] {
  // Base case: text fits in one chunk
  if (text.length <= maxSize) {
    return [text];
  }

  // Try each separator in order
  for (const separator of separators) {
    const parts = text.split(separator);
    
    // If only one part, separator not found - try next
    if (parts.length === 1) continue;

    const chunks: string[] = [];
    let currentChunk = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const potentialChunk = currentChunk 
        ? currentChunk + separator + part 
        : part;

      if (potentialChunk.length <= maxSize) {
        currentChunk = potentialChunk;
      } else {
        // Current chunk is full
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
        }

        // Check if part itself exceeds max size
        if (part.length > maxSize) {
          // Need to split further with next separator
          const subChunks = recursiveSplit(
            part,
            separators.slice(separators.indexOf(separator) + 1),
            maxSize,
            minSize
          );
          chunks.push(...subChunks);
          currentChunk = '';
        } else {
          currentChunk = part;
        }
      }
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    // Only return if we made progress
    if (chunks.length > 1 || chunks[0]?.length <= maxSize) {
      return chunks;
    }
  }

  // Fallback: hard split at maxSize (avoid mid-sentence if possible)
  return hardSplit(text, maxSize);
}

/**
 * Hard split text at size limit, preferring sentence boundaries
 */
function hardSplit(text: string, maxSize: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxSize) {
    let splitIndex = maxSize;

    // Look for sentence ending before maxSize
    const searchRange = remaining.slice(0, maxSize);
    const sentenceMatches = [...searchRange.matchAll(/[.!?]\s+/g)];
    
    if (sentenceMatches.length > 0) {
      // Use the last sentence ending within range
      const lastMatch = sentenceMatches[sentenceMatches.length - 1];
      splitIndex = lastMatch.index! + lastMatch[0].length;
    } else {
      // Look for word boundary
      const lastSpace = remaining.lastIndexOf(' ', maxSize);
      if (lastSpace > maxSize * 0.5) {
        splitIndex = lastSpace + 1;
      }
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Get overlap text from the end of a previous chunk
 */
function getOverlapText(text: string, overlapSize: number): string {
  if (text.length <= overlapSize) {
    return text;
  }

  // Try to start overlap at a sentence or word boundary
  const overlapStart = text.length - overlapSize;
  const searchText = text.slice(overlapStart);
  
  // Look for sentence start
  const sentenceMatch = searchText.match(/[.!?]\s+/);
  if (sentenceMatch && sentenceMatch.index !== undefined) {
    return searchText.slice(sentenceMatch.index + sentenceMatch[0].length);
  }

  // Look for word boundary
  const spaceIndex = searchText.indexOf(' ');
  if (spaceIndex > 0) {
    return searchText.slice(spaceIndex + 1);
  }

  return searchText;
}

// ============================================================================
// Chunk Merging
// ============================================================================

/**
 * Merge chunks that are too small
 */
export function mergeSmallChunks(
  chunks: DocumentChunk[],
  minSize: number
): DocumentChunk[] {
  if (chunks.length <= 1) return chunks;

  const merged: DocumentChunk[] = [];
  let pendingChunk: DocumentChunk | null = null;

  for (const chunk of chunks) {
    if (pendingChunk === null) {
      if (chunk.content.length < minSize) {
        pendingChunk = chunk;
      } else {
        merged.push(chunk);
      }
    } else {
      // Merge with pending
      const combinedContent = pendingChunk.content + '\n\n' + chunk.content;
      
      if (combinedContent.length < minSize && chunks.indexOf(chunk) < chunks.length - 1) {
        // Still too small, keep merging
        pendingChunk = {
          ...pendingChunk,
          content: combinedContent,
          endOffset: chunk.endOffset,
        };
      } else {
        // Merged chunk is big enough
        merged.push({
          ...pendingChunk,
          content: combinedContent,
          endOffset: chunk.endOffset,
        });
        pendingChunk = null;
      }
    }
  }

  // Don't forget pending chunk
  if (pendingChunk !== null) {
    merged.push(pendingChunk);
  }

  // Re-index chunks
  return merged.map((chunk, index) => ({
    ...chunk,
    chunkIndex: index,
    id: chunk.id.replace(/_\d+$/, `_${index}`),
  }));
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract headings from plain text content
 */
export function extractHeadings(
  content: string
): Array<{ level: number; text: string; pageNumber?: number }> {
  const headings: Array<{ level: number; text: string }> = [];
  
  // Match common heading patterns
  const patterns = [
    // Markdown style: # Heading
    /^(#{1,6})\s+(.+)$/gm,
    // UPPERCASE HEADINGS
    /^([A-Z][A-Z\s]{5,50})$/gm,
    // Numbered sections: 1. Heading or 1.1 Heading
    /^(\d+(?:\.\d+)*)\s+([A-Z][^.!?\n]+)$/gm,
  ];

  for (const pattern of patterns) {
    let match;
    pattern.lastIndex = 0;
    
    while ((match = pattern.exec(content)) !== null) {
      const level = match[1].startsWith('#') 
        ? match[1].length 
        : match[1].includes('.') 
          ? match[1].split('.').length + 1
          : 1;
      
      const text = (match[2] || match[1]).trim();
      
      if (text.length > 2 && text.length < 100) {
        headings.push({ level, text });
      }
    }
  }

  return headings;
}

/**
 * Find headings applicable to a specific page
 */
function findApplicableHeadings(
  headings: Array<{ level: number; text: string; pageNumber?: number }>,
  pageNumber?: number
): string[] | undefined {
  if (!headings || headings.length === 0) return undefined;

  // If no page numbers on headings, return top-level headings
  if (!headings.some(h => h.pageNumber)) {
    return headings
      .filter(h => h.level <= 2)
      .slice(0, 3)
      .map(h => h.text);
  }

  // Find headings up to current page
  if (pageNumber) {
    const applicable = headings
      .filter(h => !h.pageNumber || h.pageNumber <= pageNumber)
      .slice(-3)
      .map(h => h.text);
    
    return applicable.length > 0 ? applicable : undefined;
  }

  return undefined;
}

/**
 * Calculate chunking statistics
 */
function calculateStats(
  document: ParsedDocument,
  chunks: DocumentChunk[],
  startTime: number
): ChunkingStats {
  const chunkSizes = chunks.map(c => c.content.length);
  
  return {
    documentId: document.metadata.id,
    filename: document.metadata.filename,
    totalChunks: chunks.length,
    avgChunkSize: chunks.length > 0 
      ? Math.round(chunkSizes.reduce((a, b) => a + b, 0) / chunks.length)
      : 0,
    minChunkSize: chunks.length > 0 ? Math.min(...chunkSizes) : 0,
    maxChunkSize: chunks.length > 0 ? Math.max(...chunkSizes) : 0,
    totalCharacters: document.content.length,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Log chunking statistics
 */
function logChunkingStats(stats: ChunkingStats): void {
  logger.info('Document chunking completed', {
    documentId: stats.documentId,
    filename: stats.filename,
    chunks: stats.totalChunks,
    avgSize: stats.avgChunkSize,
    minSize: stats.minChunkSize,
    maxSize: stats.maxChunkSize,
    totalChars: stats.totalCharacters,
    durationMs: stats.processingTimeMs,
  });
}

// ============================================================================
// Exports
// ============================================================================

export default {
  chunkDocument,
  chunkAllDocuments,
  recursiveSplit,
  mergeSmallChunks,
  extractHeadings,
  DEFAULT_OPTIONS,
};
