/**
 * Vector Store Factory - Exports the appropriate vector store based on configuration
 */
import { config } from '../config';
import { logger } from '../services/logger';
import { LocalVectorStore } from './localVectorStore';
import { ChromaVectorStore } from './chroma';

// Define common interface for vector stores
export interface VectorStore {
  initialize(): Promise<void>;
  addChunks(chunks: any[]): Promise<void>;
  search(queryEmbedding: number[], topK?: number): Promise<any[]>;
  deleteByDocumentId(documentId: string): Promise<void>;
  getStats(): Promise<{ totalChunks: number; uniqueDocuments: number }>;
  clear(): Promise<void>;
  isConnected(): Promise<boolean>;
}

/**
 * Get the appropriate vector store instance based on configuration
 */
function createVectorStore(): VectorStore {
  const vectorStoreType = config.vectorStore;
  
  logger.info(`Initializing vector store type: ${vectorStoreType}`);
  
  if (vectorStoreType === 'local') {
    return new LocalVectorStore();
  } else if (vectorStoreType === 'chroma') {
    return new ChromaVectorStore();
  } else {
    logger.warn(`Unknown vector store type: ${vectorStoreType}, defaulting to local`);
    return new LocalVectorStore();
  }
}

// Export singleton instance
export const vectorStore = createVectorStore();
export default vectorStore;
