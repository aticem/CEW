/**
 * Embedder - Generates embeddings for text chunks using OpenAI
 */
import { OpenAI } from 'openai';
import { DocumentChunk } from '../types';
import { logger } from '../services/logger';
import { config } from '../config';

/**
 * Embedder class - handles text embedding generation
 */
export class Embedder {
  private openai: OpenAI;
  private model: string;
  private batchSize: number = 100;
  private retryAttempts: number = 3;
  private retryDelay: number = 1000; // ms

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openaiApiKey,
    });
    this.model = config.embeddingModel;
    
    logger.info(`Embedder initialized with model: ${this.model}`);
  }

  /**
   * Generate embeddings for an array of document chunks
   * @param chunks - Array of document chunks
   * @returns Chunks with embeddings populated
   */
  async embedChunks(chunks: DocumentChunk[]): Promise<DocumentChunk[]> {
    const startTime = Date.now();
    logger.info(`Generating embeddings for ${chunks.length} chunks`);

    if (chunks.length === 0) {
      return [];
    }

    // Process in batches to avoid rate limits
    const batches = this.createBatches(chunks, this.batchSize);
    const embeddedChunks: DocumentChunk[] = [];
    let totalTokens = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} chunks)`);

      try {
        const batchResult = await this.embedBatch(batch);
        embeddedChunks.push(...batchResult.chunks);
        totalTokens += batchResult.tokens;
      } catch (error) {
        logger.error(`Failed to process batch ${i + 1}`, { error });
        throw error;
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`Embedding generation completed`, {
      totalChunks: embeddedChunks.length,
      totalTokens,
      duration: `${duration}ms`,
      avgTimePerChunk: `${Math.round(duration / embeddedChunks.length)}ms`
    });

    return embeddedChunks;
  }

  /**
   * Generate embeddings for a single batch of chunks
   * @param chunks - Batch of chunks
   * @returns Chunks with embeddings and token count
   */
  private async embedBatch(chunks: DocumentChunk[]): Promise<{
    chunks: DocumentChunk[];
    tokens: number;
  }> {
    const texts = chunks.map(chunk => chunk.content);
    
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.retryAttempts) {
      try {
        const response = await this.openai.embeddings.create({
          model: this.model,
          input: texts,
        });

        // Attach embeddings to chunks
        const embeddedChunks = chunks.map((chunk, index) => ({
          ...chunk,
          embedding: response.data[index].embedding
        }));

        return {
          chunks: embeddedChunks,
          tokens: response.usage.total_tokens
        };

      } catch (error) {
        attempt++;
        lastError = error as Error;
        
        logger.warn(`Embedding attempt ${attempt} failed`, {
          error: lastError.message,
          willRetry: attempt < this.retryAttempts
        });

        if (attempt < this.retryAttempts) {
          // Exponential backoff
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.info(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`Failed to generate embeddings after ${this.retryAttempts} attempts: ${lastError?.message}`);
  }

  /**
   * Generate embedding for a single text string
   * @param text - Text to embed
   * @returns Embedding vector
   */
  async embedText(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: text,
      });

      logger.debug(`Generated embedding for text`, {
        textLength: text.length,
        tokens: response.usage.total_tokens
      });

      return response.data[0].embedding;
    } catch (error) {
      logger.error('Failed to generate embedding for text', { error });
      throw error;
    }
  }

  /**
   * Create batches from an array
   * @param items - Array of items
   * @param batchSize - Size of each batch
   * @returns Array of batches
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Sleep for specified milliseconds
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get embedding dimensions for the current model
   */
  getEmbeddingDimensions(): number {
    return config.embeddingDimensions;
  }

  /**
   * Test OpenAI connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.embedText('test');
      logger.info('OpenAI embeddings API connection successful');
      return true;
    } catch (error) {
      logger.error('OpenAI embeddings API connection failed', { error });
      return false;
    }
  }
}

// Singleton instance
export const embedder = new Embedder();
export default embedder;
