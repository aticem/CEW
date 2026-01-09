/**
 * Local File-Based Vector Store - Simple persistent storage using JSON files
 */
import fs from 'fs/promises';
import path from 'path';
import { DocumentChunk, SearchResult } from '../types';
import { logger } from '../services/logger';
import { config } from '../config';

interface StoredChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  pageNumber?: number;
  startIndex: number;
  endIndex: number;
  metadata: {
    id: string;
    filename: string;
    filepath: string;
    fileType: string;
    fileSize: number;
    ingestedAt: string;
    ocrApplied: boolean;
  };
}

/**
 * Local Vector Store - File-based implementation
 */
export class LocalVectorStore {
  private storePath: string;
  private chunksFile: string;
  private chunks: Map<string, StoredChunk> = new Map();
  private isInitialized: boolean = false;

  constructor() {
    this.storePath = path.resolve(config.vectorStorePath);
    this.chunksFile = path.join(this.storePath, 'chunks.json');
    logger.info(`Local Vector Store configured`, { path: this.storePath });
  }

  /**
   * Initialize the local vector store
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Local vector store already initialized');
      return;
    }

    try {
      logger.info('Initializing local vector store...');
      
      // Create directory if it doesn't exist
      await fs.mkdir(this.storePath, { recursive: true });
      
      // Load existing chunks if file exists
      try {
        const data = await fs.readFile(this.chunksFile, 'utf-8');
        const chunksArray: StoredChunk[] = JSON.parse(data);
        this.chunks = new Map(chunksArray.map(chunk => [chunk.id, chunk]));
        logger.info(`Loaded ${this.chunks.size} chunks from local storage`);
      } catch (error) {
        // File doesn't exist yet, start fresh
        logger.info('No existing chunks file, starting fresh');
        this.chunks = new Map();
      }

      this.isInitialized = true;
      logger.info('Local vector store initialized successfully');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to initialize local vector store', { error: errorMsg });
      throw new Error(`Local vector store initialization failed: ${errorMsg}`);
    }
  }

  /**
   * Add document chunks to the store
   */
  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    if (chunks.length === 0) {
      logger.warn('No chunks to add');
      return;
    }

    logger.info(`Adding ${chunks.length} chunks to local vector store`);

    try {
      for (const chunk of chunks) {
        if (!chunk.embedding) {
          throw new Error(`Chunk ${chunk.id} has no embedding`);
        }

        const storedChunk: StoredChunk = {
          id: chunk.id,
          documentId: chunk.documentId,
          content: chunk.content,
          embedding: chunk.embedding,
          pageNumber: chunk.pageNumber,
          startIndex: chunk.startIndex,
          endIndex: chunk.endIndex,
          metadata: {
            ...chunk.metadata,
            ingestedAt: chunk.metadata.ingestedAt.toISOString()
          }
        };

        this.chunks.set(chunk.id, storedChunk);
      }

      // Persist to disk
      await this.save();

      logger.info(`Successfully added ${chunks.length} chunks to local vector store`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add chunks to local vector store', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Search for similar chunks using cosine similarity
   */
  async search(queryEmbedding: number[], topK: number = 5): Promise<SearchResult[]> {
    if (!this.isInitialized) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    try {
      logger.debug(`Searching local vector store`, { topK });

      // Calculate cosine similarity for all chunks
      const results: Array<{ chunk: StoredChunk; similarity: number }> = [];
      
      for (const chunk of this.chunks.values()) {
        const similarity = this.cosineSimilarity(queryEmbedding, chunk.embedding);
        results.push({ chunk, similarity });
      }

      // Sort by similarity (descending) and take top K
      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, topK);

      // Transform to SearchResult format
      const searchResults: SearchResult[] = topResults.map(({ chunk, similarity }) => ({
        chunk: {
          id: chunk.id,
          documentId: chunk.documentId,
          content: chunk.content,
          embedding: chunk.embedding,
          startIndex: chunk.startIndex,
          endIndex: chunk.endIndex,
          pageNumber: chunk.pageNumber,
          metadata: {
            ...chunk.metadata,
            ingestedAt: new Date(chunk.metadata.ingestedAt)
          }
        },
        score: similarity,
        distance: 1 - similarity
      }));

      logger.info(`Found ${searchResults.length} similar chunks`);
      return searchResults;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Local vector search failed', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Delete chunks by document ID
   */
  async deleteByDocumentId(documentId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    try {
      logger.info(`Deleting chunks for document: ${documentId}`);
      
      let deletedCount = 0;
      for (const [id, chunk] of this.chunks.entries()) {
        if (chunk.documentId === documentId) {
          this.chunks.delete(id);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        await this.save();
        logger.info(`Deleted ${deletedCount} chunks for document ${documentId}`);
      } else {
        logger.warn(`No chunks found for document ${documentId}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to delete chunks for document ${documentId}`, { error: errorMsg });
      throw error;
    }
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<{
    totalChunks: number;
    uniqueDocuments: number;
  }> {
    if (!this.isInitialized) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    try {
      const uniqueDocIds = new Set(
        Array.from(this.chunks.values()).map(chunk => chunk.documentId)
      );

      return {
        totalChunks: this.chunks.size,
        uniqueDocuments: uniqueDocIds.size
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get local vector store stats', { error: errorMsg });
      return {
        totalChunks: 0,
        uniqueDocuments: 0
      };
    }
  }

  /**
   * Clear all data from the store
   */
  async clear(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    try {
      logger.warn('Clearing all data from local vector store');
      this.chunks.clear();
      await this.save();
      logger.info('Local vector store cleared successfully');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to clear local vector store', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Check if vector store is connected (always true for local)
   */
  async isConnected(): Promise<boolean> {
    return this.isInitialized;
  }

  /**
   * Save chunks to disk
   */
  private async save(): Promise<void> {
    const chunksArray = Array.from(this.chunks.values());
    await fs.writeFile(
      this.chunksFile,
      JSON.stringify(chunksArray, null, 2),
      'utf-8'
    );
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
