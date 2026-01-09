/**
 * Embedder Module
 * @module ingest/embedder
 * 
 * Generates vector embeddings for document chunks using OpenAI.
 * Features batch processing, retry logic, and content-based caching.
 */

import crypto from 'crypto';
import OpenAI from 'openai';
import { DocumentChunk } from '../types';
import { config } from '../config';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for embedding generation
 */
export interface EmbeddingOptions {
  /** OpenAI embedding model */
  model: string;
  /** Maximum texts per API call */
  batchSize: number;
  /** Embedding dimensions (model-dependent) */
  dimensions?: number;
  /** Maximum retry attempts on rate limit */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number;
  /** Enable content hash caching */
  enableCache: boolean;
}

/**
 * Token usage statistics
 */
export interface EmbeddingUsage {
  /** Total tokens used */
  totalTokens: number;
  /** Number of texts embedded */
  textCount: number;
  /** Number of API calls made */
  apiCalls: number;
  /** Cache hits (if caching enabled) */
  cacheHits: number;
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * Result of embedding operation
 */
export interface EmbeddingResult {
  /** Generated embedding vector */
  embedding: number[];
  /** Token count for this text */
  tokenCount: number;
  /** Whether result was from cache */
  fromCache: boolean;
}

/**
 * Batch embedding result
 */
export interface BatchEmbeddingResult {
  /** Embeddings in same order as input */
  embeddings: number[][];
  /** Usage statistics */
  usage: EmbeddingUsage;
}

// ============================================================================
// Constants
// ============================================================================

/** Default embedding options */
const DEFAULT_OPTIONS: EmbeddingOptions = {
  model: config.llm.embeddingModel || 'text-embedding-3-small',
  batchSize: 100,
  dimensions: 1536,
  maxRetries: 5,
  baseDelayMs: 1000,
  enableCache: true,
};

/** Maximum text length for embedding (tokens, approx 4 chars per token) */
const MAX_TEXT_LENGTH = 8191 * 4; // ~32K chars

// ============================================================================
// Cache
// ============================================================================

/**
 * In-memory embedding cache (keyed by content hash)
 * In production, this could be Redis or a persistent store
 */
const embeddingCache = new Map<string, { embedding: number[]; tokenCount: number }>();

/**
 * Generate content hash for cache key
 */
function getContentHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Get cached embedding if available
 */
function getCached(text: string): { embedding: number[]; tokenCount: number } | undefined {
  const hash = getContentHash(text);
  return embeddingCache.get(hash);
}

/**
 * Store embedding in cache
 */
function setCache(text: string, embedding: number[], tokenCount: number): void {
  const hash = getContentHash(text);
  embeddingCache.set(hash, { embedding, tokenCount });
}

/**
 * Clear the embedding cache
 */
export function clearCache(): void {
  embeddingCache.clear();
  logger.info('Embedding cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; memoryEstimateMB: number } {
  const size = embeddingCache.size;
  // Rough estimate: 1536 floats * 8 bytes + overhead
  const memoryEstimateMB = (size * 1536 * 8 + size * 100) / (1024 * 1024);
  return { size, memoryEstimateMB: Math.round(memoryEstimateMB * 100) / 100 };
}

// ============================================================================
// OpenAI Client
// ============================================================================

let openaiClient: OpenAI | null = null;

/**
 * Get or create OpenAI client
 */
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (!config.llm.apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    openaiClient = new OpenAI({
      apiKey: config.llm.apiKey,
    });
  }
  return openaiClient;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Generate embedding for a single text
 * @param text - Text to embed
 * @param options - Embedding options
 * @returns Embedding result with vector and metadata
 */
export async function generateEmbedding(
  text: string,
  options: Partial<EmbeddingOptions> = {}
): Promise<EmbeddingResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Validate input
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text');
  }

  // Truncate if too long
  const truncatedText = text.length > MAX_TEXT_LENGTH 
    ? text.slice(0, MAX_TEXT_LENGTH) 
    : text;

  if (text.length > MAX_TEXT_LENGTH) {
    logger.warn('Text truncated for embedding', {
      originalLength: text.length,
      truncatedLength: truncatedText.length,
    });
  }

  // Check cache
  if (opts.enableCache) {
    const cached = getCached(truncatedText);
    if (cached) {
      logger.debug('Embedding cache hit', { 
        textLength: truncatedText.length,
        hash: getContentHash(truncatedText).slice(0, 8),
      });
      return {
        embedding: cached.embedding,
        tokenCount: cached.tokenCount,
        fromCache: true,
      };
    }
  }

  // Generate embedding with retry
  const result = await embedWithRetry([truncatedText], opts);
  
  const embedding = result.embeddings[0];
  const tokenCount = result.usage.totalTokens;

  // Cache result
  if (opts.enableCache) {
    setCache(truncatedText, embedding, tokenCount);
  }

  return {
    embedding,
    tokenCount,
    fromCache: false,
  };
}

/**
 * Generate embeddings for multiple document chunks
 * @param chunks - Document chunks to embed
 * @param options - Embedding options
 * @returns Chunks with embeddings attached
 */
export async function embedChunks(
  chunks: DocumentChunk[],
  options: Partial<EmbeddingOptions> = {}
): Promise<DocumentChunk[]> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  if (chunks.length === 0) {
    return [];
  }

  logger.info('Starting chunk embedding', {
    chunkCount: chunks.length,
    model: opts.model,
    batchSize: opts.batchSize,
  });

  // Track usage
  const usage: EmbeddingUsage = {
    totalTokens: 0,
    textCount: chunks.length,
    apiCalls: 0,
    cacheHits: 0,
    processingTimeMs: 0,
  };

  // Separate cached and uncached chunks
  const results: Array<{ index: number; embedding: number[]; tokenCount: number }> = [];
  const toEmbed: Array<{ index: number; text: string }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    if (opts.enableCache) {
      const cached = getCached(chunk.content);
      if (cached) {
        results.push({ 
          index: i, 
          embedding: cached.embedding, 
          tokenCount: cached.tokenCount 
        });
        usage.cacheHits++;
        continue;
      }
    }
    
    toEmbed.push({ index: i, text: chunk.content });
  }

  logger.debug('Cache lookup complete', {
    cacheHits: usage.cacheHits,
    toEmbed: toEmbed.length,
  });

  // Process uncached in batches
  for (let i = 0; i < toEmbed.length; i += opts.batchSize) {
    const batch = toEmbed.slice(i, i + opts.batchSize);
    const texts = batch.map(b => b.text);
    
    logger.debug('Processing batch', {
      batchNumber: Math.floor(i / opts.batchSize) + 1,
      batchSize: batch.length,
    });

    const batchResult = await embedWithRetry(texts, opts);
    usage.apiCalls++;
    usage.totalTokens += batchResult.usage.totalTokens;

    // Store results and cache
    for (let j = 0; j < batch.length; j++) {
      const embedding = batchResult.embeddings[j];
      const tokenCount = Math.floor(batchResult.usage.totalTokens / batch.length);
      
      results.push({
        index: batch[j].index,
        embedding,
        tokenCount,
      });

      if (opts.enableCache) {
        setCache(batch[j].text, embedding, tokenCount);
      }
    }
  }

  // Attach embeddings to chunks
  const embeddedChunks = chunks.map((chunk, index) => {
    const result = results.find(r => r.index === index);
    if (!result) {
      logger.error('Missing embedding result for chunk', { chunkIndex: index });
      return chunk;
    }
    return {
      ...chunk,
      embedding: result.embedding,
      tokenCount: result.tokenCount,
    };
  });

  usage.processingTimeMs = Date.now() - startTime;

  logger.info('Chunk embedding completed', {
    chunkCount: chunks.length,
    totalTokens: usage.totalTokens,
    apiCalls: usage.apiCalls,
    cacheHits: usage.cacheHits,
    durationMs: usage.processingTimeMs,
  });

  return embeddedChunks;
}

/**
 * Generate embeddings for a batch of texts
 * @param texts - Texts to embed
 * @param options - Embedding options
 * @returns Embeddings array in same order as input
 */
export async function embedBatch(
  texts: string[],
  options: Partial<EmbeddingOptions> = {}
): Promise<BatchEmbeddingResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  if (texts.length === 0) {
    return {
      embeddings: [],
      usage: {
        totalTokens: 0,
        textCount: 0,
        apiCalls: 0,
        cacheHits: 0,
        processingTimeMs: 0,
      },
    };
  }

  return embedWithRetry(texts, opts);
}

// ============================================================================
// API Call with Retry
// ============================================================================

/**
 * Call OpenAI embedding API with exponential backoff retry
 */
async function embedWithRetry(
  texts: string[],
  options: EmbeddingOptions
): Promise<BatchEmbeddingResult> {
  const startTime = Date.now();
  const client = getOpenAIClient();
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    try {
      const response = await client.embeddings.create({
        model: options.model,
        input: texts,
      });

      const embeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map(d => d.embedding);

      return {
        embeddings,
        usage: {
          totalTokens: response.usage?.total_tokens || 0,
          textCount: texts.length,
          apiCalls: 1,
          cacheHits: 0,
          processingTimeMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if rate limited (429)
      const isRateLimited = 
        (error as { status?: number })?.status === 429 ||
        lastError.message.includes('429') ||
        lastError.message.toLowerCase().includes('rate limit');

      if (isRateLimited && attempt < options.maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const delayMs = options.baseDelayMs * Math.pow(2, attempt);
        
        logger.warn('Rate limited, retrying with backoff', {
          attempt: attempt + 1,
          maxRetries: options.maxRetries,
          delayMs,
        });

        await sleep(delayMs);
        continue;
      }

      // Non-rate-limit error or max retries exceeded
      logger.error('Embedding API call failed', {
        attempt: attempt + 1,
        error: lastError.message,
        textCount: texts.length,
      });

      throw lastError;
    }
  }

  throw lastError || new Error('Embedding failed after max retries');
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate cosine similarity between two vectors
 * @param a - First vector
 * @param b - Second vector
 * @returns Similarity score (0-1)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}

/**
 * Calculate euclidean distance between two vectors
 * @param a - First vector
 * @param b - Second vector
 * @returns Distance (lower = more similar)
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Estimate token count for text (rough approximation)
 * OpenAI uses ~4 characters per token on average
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Exports
// ============================================================================

export default {
  generateEmbedding,
  embedChunks,
  embedBatch,
  cosineSimilarity,
  euclideanDistance,
  estimateTokenCount,
  clearCache,
  getCacheStats,
  DEFAULT_OPTIONS,
};
