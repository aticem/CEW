/**
 * Document Retriever Module
 * @module query/retriever
 * 
 * Handles semantic search and document retrieval from the vector index.
 * Provides deterministic retrieval with scoring and filtering.
 */

import { DocumentChunk, DocumentMetadata } from '../types';
import { generateEmbedding } from '../ingest/embedder';
import { searchIndex, getDocumentEntry } from '../ingest/indexer';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * Retrieved chunk with score and document metadata
 */
export interface RetrievedChunk {
  /** The document chunk */
  chunk: DocumentChunk;
  /** Similarity score (0-1, higher = more relevant) */
  score: number;
  /** Parent document metadata */
  document: DocumentMetadata;
}

/**
 * Options for chunk retrieval
 */
export interface RetrievalOptions {
  /** Maximum number of chunks to return (default: 5) */
  topK?: number;
  /** Minimum similarity score threshold (default: 0.7) */
  scoreThreshold?: number;
  /** Filter criteria */
  filter?: {
    /** Filter by source/category */
    source?: string;
    /** Filter by specific document ID */
    documentId?: string;
    /** Filter by multiple document IDs */
    documentIds?: string[];
  };
}

/**
 * Retrieval statistics for logging
 */
export interface RetrievalStats {
  /** Original query (truncated) */
  queryPreview: string;
  /** Time to generate query embedding (ms) */
  embeddingTimeMs: number;
  /** Time to search index (ms) */
  searchTimeMs: number;
  /** Total retrieval time (ms) */
  totalTimeMs: number;
  /** Number of results from index */
  rawResults: number;
  /** Number of results after filtering */
  filteredResults: number;
  /** Number of results returned */
  returnedResults: number;
  /** Top score */
  topScore: number;
  /** Average score of returned results */
  avgScore: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default retrieval options */
const DEFAULT_OPTIONS: Required<Omit<RetrievalOptions, 'filter'>> = {
  topK: 5,
  scoreThreshold: 0.7,
};

// ============================================================================
// Main Retrieval Function
// ============================================================================

/**
 * Retrieve relevant document chunks for a query
 * 
 * Process:
 * 1. Generate query embedding
 * 2. Search vector index
 * 3. Filter by score threshold
 * 4. Enrich with document metadata
 * 5. Sort by score descending
 * 6. Return top K results
 * 
 * @param query - User query string
 * @param options - Retrieval options (topK, scoreThreshold, filter)
 * @returns Array of retrieved chunks with scores and document metadata
 * 
 * @example
 * ```typescript
 * const chunks = await retrieveRelevantChunks(
 *   'What is the acceptance criteria for DC cables?',
 *   { topK: 5, scoreThreshold: 0.7 }
 * );
 * 
 * for (const { chunk, score, document } of chunks) {
 *   console.log(`[${score.toFixed(2)}] ${document.filename}: ${chunk.content.slice(0, 100)}...`);
 * }
 * ```
 */
export async function retrieveRelevantChunks(
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievedChunk[]> {
  const startTime = Date.now();
  const topK = options.topK ?? DEFAULT_OPTIONS.topK;
  const scoreThreshold = options.scoreThreshold ?? DEFAULT_OPTIONS.scoreThreshold;

  logger.debug('Starting retrieval', {
    queryPreview: query.substring(0, 100),
    topK,
    scoreThreshold,
    filter: options.filter,
  });

  // Handle empty query
  if (!query || query.trim().length === 0) {
    logger.warn('Empty query provided to retriever');
    return [];
  }

  // Step 1: Generate query embedding
  const embeddingStartTime = Date.now();
  let queryEmbedding: number[];
  
  try {
    const embeddingResult = await generateEmbedding(query);
    queryEmbedding = embeddingResult.embedding;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate query embedding', { error: errorMsg });
    throw new Error(`Embedding generation failed: ${errorMsg}`);
  }
  
  const embeddingTimeMs = Date.now() - embeddingStartTime;

  // Step 2: Search vector index
  const searchStartTime = Date.now();
  
  // Build filter for index search
  const indexFilter = buildIndexFilter(options.filter);
  
  // Request more results than needed to account for filtering
  const searchTopK = Math.min(topK * 3, 50);
  
  let searchResults;
  try {
    searchResults = await searchIndex(queryEmbedding, searchTopK, indexFilter);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Index search failed', { error: errorMsg });
    throw new Error(`Index search failed: ${errorMsg}`);
  }
  
  const searchTimeMs = Date.now() - searchStartTime;
  const rawResults = searchResults.chunks.length;

  // Step 3: Filter by score threshold and deduplicate
  const filteredResults = filterAndDeduplicate(
    searchResults.chunks,
    searchResults.scores,
    scoreThreshold
  );

  // Step 4: Enrich with document metadata
  const enrichedResults = enrichWithMetadata(filteredResults);

  // Step 5: Sort by score descending (should already be sorted, but ensure)
  enrichedResults.sort((a, b) => b.score - a.score);

  // Step 6: Return top K
  const finalResults = enrichedResults.slice(0, topK);

  // Calculate and log stats
  const totalTimeMs = Date.now() - startTime;
  const stats = calculateStats(
    query,
    embeddingTimeMs,
    searchTimeMs,
    totalTimeMs,
    rawResults,
    filteredResults.length,
    finalResults
  );
  logRetrievalStats(stats);

  return finalResults;
}

// ============================================================================
// Context Formatting
// ============================================================================

/**
 * Format retrieved chunks as context for LLM
 * 
 * Creates a formatted string with source citations for each chunk.
 * 
 * Format:
 * ```
 * [Source: filename.pdf, Page 3]
 * Content of the chunk...
 * 
 * [Source: another.docx]
 * More content...
 * ```
 * 
 * @param chunks - Retrieved chunks to format
 * @returns Formatted context string for LLM prompt
 * 
 * @example
 * ```typescript
 * const chunks = await retrieveRelevantChunks(query);
 * const context = formatContextForLLM(chunks);
 * // Use in prompt: `Based on the following context:\n${context}\n\nAnswer: ...`
 * ```
 */
export function formatContextForLLM(chunks: RetrievedChunk[]): string {
  // Handle no results
  if (!chunks || chunks.length === 0) {
    logger.debug('No chunks to format for LLM context');
    return '';
  }

  const formattedChunks: string[] = [];

  for (const { chunk, score, document } of chunks) {
    // Build source citation
    const sourceParts: string[] = [];
    
    // Filename
    sourceParts.push(document.filename || 'Unknown');
    
    // Page number if available
    if (chunk.pageNumber && chunk.pageNumber > 0) {
      sourceParts.push(`Page ${chunk.pageNumber}`);
    }
    
    // Score for debugging (optional, can be removed in production)
    // sourceParts.push(`Score: ${score.toFixed(2)}`);

    const sourceHeader = `[Source: ${sourceParts.join(', ')}]`;
    
    // Clean and trim content
    const content = chunk.content.trim();
    
    // Skip empty content
    if (!content) {
      continue;
    }

    formattedChunks.push(`${sourceHeader}\n${content}`);
  }

  // Join with double newlines for separation
  return formattedChunks.join('\n\n---\n\n');
}

/**
 * Format context with relevance scores (for debugging)
 * 
 * @param chunks - Retrieved chunks
 * @returns Formatted context with scores
 */
export function formatContextWithScores(chunks: RetrievedChunk[]): string {
  if (!chunks || chunks.length === 0) {
    return 'No relevant documents found.';
  }

  const formattedChunks: string[] = [];

  for (const { chunk, score, document } of chunks) {
    const header = `[Source: ${document.filename}${chunk.pageNumber ? `, Page ${chunk.pageNumber}` : ''} | Relevance: ${(score * 100).toFixed(0)}%]`;
    formattedChunks.push(`${header}\n${chunk.content.trim()}`);
  }

  return formattedChunks.join('\n\n---\n\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build filter object for index search
 */
function buildIndexFilter(
  filter?: RetrievalOptions['filter']
): { documentIds?: string[]; category?: string } | undefined {
  if (!filter) {
    return undefined;
  }

  const indexFilter: { documentIds?: string[]; category?: string } = {};

  // Document ID filter
  if (filter.documentId) {
    indexFilter.documentIds = [filter.documentId];
  } else if (filter.documentIds && filter.documentIds.length > 0) {
    indexFilter.documentIds = filter.documentIds;
  }

  // Source/category filter
  if (filter.source) {
    indexFilter.category = filter.source;
  }

  return Object.keys(indexFilter).length > 0 ? indexFilter : undefined;
}

/**
 * Filter results by score threshold and remove duplicates
 */
function filterAndDeduplicate(
  chunks: DocumentChunk[],
  scores: number[],
  scoreThreshold: number
): Array<{ chunk: DocumentChunk; score: number }> {
  const results: Array<{ chunk: DocumentChunk; score: number }> = [];
  const seenContent = new Set<string>();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const score = scores[i];

    // Filter by score threshold
    if (score < scoreThreshold) {
      continue;
    }

    // Deduplicate by content hash (first 100 chars + length)
    const contentKey = `${chunk.content.substring(0, 100)}_${chunk.content.length}`;
    if (seenContent.has(contentKey)) {
      continue;
    }
    seenContent.add(contentKey);

    results.push({ chunk, score });
  }

  return results;
}

/**
 * Enrich chunks with document metadata from registry
 */
function enrichWithMetadata(
  results: Array<{ chunk: DocumentChunk; score: number }>
): RetrievedChunk[] {
  const enrichedResults: RetrievedChunk[] = [];

  for (const { chunk, score } of results) {
    // Get document metadata from registry
    const docEntry = getDocumentEntry(chunk.documentId);
    
    // Build document metadata (use available info or defaults)
    const document: DocumentMetadata = {
      id: chunk.documentId,
      filename: docEntry?.filename || 'Unknown',
      filePath: docEntry?.filePath || '',
      fileType: (docEntry?.metadata?.fileType as DocumentMetadata['fileType']) || 'unknown',
      sizeBytes: docEntry?.metadata?.sizeBytes as number || 0,
      pageCount: docEntry?.metadata?.pageCount as number,
      title: docEntry?.metadata?.title as string,
      category: docEntry?.metadata?.category as string,
      ingestedAt: docEntry?.indexedAt || new Date().toISOString(),
    };

    enrichedResults.push({
      chunk,
      score,
      document,
    });
  }

  return enrichedResults;
}

/**
 * Calculate retrieval statistics
 */
function calculateStats(
  query: string,
  embeddingTimeMs: number,
  searchTimeMs: number,
  totalTimeMs: number,
  rawResults: number,
  filteredResults: number,
  finalResults: RetrievedChunk[]
): RetrievalStats {
  const scores = finalResults.map(r => r.score);
  
  return {
    queryPreview: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
    embeddingTimeMs,
    searchTimeMs,
    totalTimeMs,
    rawResults,
    filteredResults,
    returnedResults: finalResults.length,
    topScore: scores.length > 0 ? Math.max(...scores) : 0,
    avgScore: scores.length > 0 
      ? scores.reduce((a, b) => a + b, 0) / scores.length 
      : 0,
  };
}

/**
 * Log retrieval statistics
 */
function logRetrievalStats(stats: RetrievalStats): void {
  logger.info('Retrieval completed', {
    query: stats.queryPreview,
    results: stats.returnedResults,
    topScore: stats.topScore.toFixed(3),
    avgScore: stats.avgScore.toFixed(3),
    embeddingMs: stats.embeddingTimeMs,
    searchMs: stats.searchTimeMs,
    totalMs: stats.totalTimeMs,
    rawResults: stats.rawResults,
    filtered: stats.filteredResults,
  });
}

// ============================================================================
// Additional Utility Functions
// ============================================================================

/**
 * Check if any results were found above threshold
 * 
 * @param chunks - Retrieved chunks
 * @returns True if results exist
 */
export function hasResults(chunks: RetrievedChunk[]): boolean {
  return chunks.length > 0;
}

/**
 * Get the highest scoring chunk
 * 
 * @param chunks - Retrieved chunks
 * @returns Highest scoring chunk or undefined
 */
export function getTopResult(chunks: RetrievedChunk[]): RetrievedChunk | undefined {
  if (chunks.length === 0) {
    return undefined;
  }
  return chunks.reduce((best, current) => 
    current.score > best.score ? current : best
  );
}

/**
 * Group retrieved chunks by document
 * 
 * @param chunks - Retrieved chunks
 * @returns Map of document ID to chunks
 */
export function groupByDocument(
  chunks: RetrievedChunk[]
): Map<string, RetrievedChunk[]> {
  const grouped = new Map<string, RetrievedChunk[]>();
  
  for (const chunk of chunks) {
    const docId = chunk.chunk.documentId;
    const existing = grouped.get(docId) || [];
    existing.push(chunk);
    grouped.set(docId, existing);
  }
  
  return grouped;
}

/**
 * Get unique document sources from results
 * 
 * @param chunks - Retrieved chunks
 * @returns Array of unique document filenames
 */
export function getUniqueSources(chunks: RetrievedChunk[]): string[] {
  const sources = new Set<string>();
  
  for (const chunk of chunks) {
    sources.add(chunk.document.filename);
  }
  
  return Array.from(sources);
}

/**
 * Create a summary of retrieval results
 * 
 * @param chunks - Retrieved chunks
 * @returns Summary object
 */
export function getRetrievalSummary(chunks: RetrievedChunk[]): {
  count: number;
  sources: string[];
  topScore: number;
  avgScore: number;
  hasHighConfidence: boolean;
} {
  const scores = chunks.map(c => c.score);
  
  return {
    count: chunks.length,
    sources: getUniqueSources(chunks),
    topScore: scores.length > 0 ? Math.max(...scores) : 0,
    avgScore: scores.length > 0 
      ? scores.reduce((a, b) => a + b, 0) / scores.length 
      : 0,
    hasHighConfidence: scores.some(s => s >= 0.85),
  };
}

// ============================================================================
// Exports
// ============================================================================

export default {
  retrieveRelevantChunks,
  formatContextForLLM,
  formatContextWithScores,
  hasResults,
  getTopResult,
  groupByDocument,
  getUniqueSources,
  getRetrievalSummary,
  DEFAULT_OPTIONS,
};
