import { OpenAIEmbeddings } from '@langchain/openai';
import { DocumentChunk } from '../types';
import { config } from '../config';
import { logger } from '../services/logger';

export interface EmbeddingResult {
  chunk: DocumentChunk;
  embedding: number[];
}

class Embedder {
  private embeddings: OpenAIEmbeddings;
  private batchSize: number = 100;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.openai.apiKey,
      modelName: config.openai.embeddingModel,
    });
  }

  async embedChunks(chunks: DocumentChunk[]): Promise<EmbeddingResult[]> {
    const startTime = Date.now();
    const results: EmbeddingResult[] = [];

    // Process in batches to avoid rate limits
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      const texts = batch.map((c) => c.content);

      try {
        const embeddings = await this.embeddings.embedDocuments(texts);

        batch.forEach((chunk, index) => {
          results.push({
            chunk: {
              ...chunk,
              embedding: embeddings[index],
            },
            embedding: embeddings[index],
          });
        });

        logger.debug('Embedded batch', {
          batchStart: i,
          batchSize: batch.length,
          totalChunks: chunks.length,
        });
      } catch (error) {
        logger.error('Embedding batch failed', {
          batchStart: i,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    }

    const processingTime = Date.now() - startTime;
    logger.info('Chunks embedded', {
      totalChunks: chunks.length,
      processingTimeMs: processingTime,
      avgTimePerChunk: Math.round(processingTime / chunks.length),
    });

    return results;
  }

  async embedQuery(query: string): Promise<number[]> {
    try {
      const embedding = await this.embeddings.embedQuery(query);
      return embedding;
    } catch (error) {
      logger.error('Query embedding failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async embedText(text: string): Promise<number[]> {
    return this.embedQuery(text);
  }

  getDimension(): number {
    return config.vectorStore.dimension;
  }
}

export const embedder = new Embedder();
