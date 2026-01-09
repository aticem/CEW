/**
 * ChromaDB Vector Store - Manages document embeddings and similarity search
 */
import { ChromaClient, Collection } from 'chromadb';
import { DocumentChunk, SearchResult } from '../types';
import { logger } from '../services/logger';
import { config } from '../config';

/**
 * Chroma Vector Store class
 */
export class ChromaVectorStore {
  private client: ChromaClient;
  private collection: Collection | null = null;
  private collectionName: string = 'cew_documents';
  private isInitialized: boolean = false;

  constructor() {
    // Initialize ChromaDB client
    const chromaUrl = config.chromaUrl || 'http://localhost:8000';
    this.client = new ChromaClient({ path: chromaUrl });
    
    logger.info(`ChromaDB client initialized`, { url: chromaUrl });
  }

  /**
   * Initialize the vector store and create/load collection
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Vector store already initialized');
      return;
    }

    try {
      logger.info('Initializing vector store...');
      
      // Try to get existing collection or create it
      try {
        this.collection = await this.client.getOrCreateCollection({
          name: this.collectionName,
          metadata: {
            description: 'CEW Document embeddings for RAG',
            created_at: new Date().toISOString()
          }
        });
        logger.info(`Loaded/created collection: ${this.collectionName}`);
      } catch (error) {
        throw new Error(`Failed to get or create collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      this.isInitialized = true;
      logger.info('Vector store initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize vector store', { error });
      throw new Error(`Vector store initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add document chunks to the vector store
   * @param chunks - Array of document chunks with embeddings
   */
  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    if (!this.collection) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    if (chunks.length === 0) {
      logger.warn('No chunks to add');
      return;
    }

    logger.info(`Adding ${chunks.length} chunks to vector store`);

    try {
      // Prepare data for Chroma
      const ids = chunks.map(chunk => chunk.id);
      const embeddings = chunks.map(chunk => {
        if (!chunk.embedding) {
          throw new Error(`Chunk ${chunk.id} has no embedding`);
        }
        return chunk.embedding;
      });
      const documents = chunks.map(chunk => chunk.content);
      const metadatas = chunks.map(chunk => ({
        documentId: chunk.documentId,
        filename: chunk.metadata.filename,
        fileType: chunk.metadata.fileType,
        pageNumber: chunk.pageNumber?.toString() || '',
        startIndex: chunk.startIndex.toString(),
        endIndex: chunk.endIndex.toString(),
      }));

      // Add to collection
      await this.collection.add({
        ids,
        embeddings,
        documents,
        metadatas
      });

      logger.info(`Successfully added ${chunks.length} chunks to vector store`);
    } catch (error) {
      logger.error('Failed to add chunks to vector store', { error });
      throw error;
    }
  }

  /**
   * Search for similar chunks using a query embedding
   * @param queryEmbedding - The query embedding vector
   * @param topK - Number of results to return
   * @returns Array of search results
   */
  async search(queryEmbedding: number[], topK: number = 5): Promise<SearchResult[]> {
    if (!this.collection) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    try {
      logger.debug(`Searching vector store`, { topK });

      const results = await this.collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK
      });

      // Transform results to SearchResult format
      const searchResults: SearchResult[] = [];
      
      if (results.ids && results.ids[0] && results.documents && results.distances && results.metadatas) {
        for (let i = 0; i < results.ids[0].length; i++) {
          const metadata = results.metadatas[0][i] as any;
          
          searchResults.push({
            chunk: {
              id: results.ids[0][i],
              documentId: metadata.documentId,
              content: results.documents[0][i] || '',
              startIndex: parseInt(metadata.startIndex || '0'),
              endIndex: parseInt(metadata.endIndex || '0'),
              pageNumber: metadata.pageNumber ? parseInt(metadata.pageNumber) : undefined,
              metadata: {
                id: metadata.documentId,
                filename: metadata.filename,
                filepath: '',
                fileType: metadata.fileType,
                fileSize: 0,
                ingestedAt: new Date(),
                ocrApplied: false
              }
            },
            score: 1 - (results.distances[0][i] || 0), // Convert distance to similarity
            distance: results.distances[0][i] || 0
          });
        }
      }

      logger.info(`Found ${searchResults.length} similar chunks`);
      return searchResults;
    } catch (error) {
      logger.error('Vector search failed', { error });
      throw error;
    }
  }

  /**
   * Delete chunks by document ID
   * @param documentId - The document ID
   */
  async deleteByDocumentId(documentId: string): Promise<void> {
    if (!this.collection) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    try {
      logger.info(`Deleting chunks for document: ${documentId}`);
      
      // Query for all chunks with this documentId
      const results = await this.collection.get({
        where: { documentId }
      });

      if (results.ids && results.ids.length > 0) {
        await this.collection.delete({
          ids: results.ids
        });
        logger.info(`Deleted ${results.ids.length} chunks for document ${documentId}`);
      } else {
        logger.warn(`No chunks found for document ${documentId}`);
      }
    } catch (error) {
      logger.error(`Failed to delete chunks for document ${documentId}`, { error });
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
    if (!this.collection) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    try {
      const count = await this.collection.count();
      
      // Get all document IDs to count unique documents
      const results = await this.collection.get();
      const uniqueDocIds = new Set(
        results.metadatas?.map((m: any) => m.documentId) || []
      );

      return {
        totalChunks: count,
        uniqueDocuments: uniqueDocIds.size
      };
    } catch (error) {
      logger.error('Failed to get vector store stats', { error });
      return {
        totalChunks: 0,
        uniqueDocuments: 0
      };
    }
  }

  /**
   * Clear all data from the vector store
   */
  async clear(): Promise<void> {
    if (!this.collection) {
      throw new Error('Vector store not initialized. Call initialize() first.');
    }

    try {
      logger.warn('Clearing all data from vector store');
      
      // Delete the collection and recreate it
      await this.client.deleteCollection({ name: this.collectionName });
      this.collection = await this.client.createCollection({
        name: this.collectionName,
        metadata: {
          description: 'CEW Document embeddings for RAG',
          created_at: new Date().toISOString()
        }
      });
      
      logger.info('Vector store cleared successfully');
    } catch (error) {
      logger.error('Failed to clear vector store', { error });
      throw error;
    }
  }

  /**
   * Check if vector store is connected
   */
  async isConnected(): Promise<boolean> {
    try {
      await this.client.heartbeat();
      return true;
    } catch (error) {
      logger.error('Vector store connection check failed', { error });
      return false;
    }
  }
}

// Singleton instance
export const chromaVectorStore = new ChromaVectorStore();
export default chromaVectorStore;
// Singleton instance
