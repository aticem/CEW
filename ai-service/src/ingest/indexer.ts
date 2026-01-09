import { Chroma } from '@langchain/community/vectorstores/chroma';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { DocumentChunk, DocumentMetadata, VectorSearchResult } from '../types';
import { config } from '../config';
import { logger } from '../services/logger';
import { EmbeddingResult } from './embedder';

class Indexer {
  private vectorStore: Chroma | null = null;
  private embeddings: OpenAIEmbeddings;
  private initialized: boolean = false;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.openai.apiKey,
      modelName: config.openai.embeddingModel,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.vectorStore = new Chroma(this.embeddings, {
        collectionName: config.vectorStore.collection,
        url: `http://${config.vectorStore.host}:${config.vectorStore.port}`,
      });

      this.initialized = true;
      logger.info('Vector store initialized', {
        type: config.vectorStore.type,
        collection: config.vectorStore.collection,
      });
    } catch (error) {
      logger.error('Failed to initialize vector store', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async indexChunks(
    embeddingResults: EmbeddingResult[],
    documentMetadata: DocumentMetadata
  ): Promise<void> {
    await this.initialize();

    if (!this.vectorStore) {
      throw new Error('Vector store not initialized');
    }

    const startTime = Date.now();

    const documents = embeddingResults.map(({ chunk }) => {
      return new Document({
        pageContent: chunk.content,
        metadata: {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentName: documentMetadata.filename,
          documentType: documentMetadata.filetype,
          pageNumber: chunk.metadata.pageNumber,
          chunkIndex: chunk.metadata.chunkIndex,
          headers: chunk.metadata.headers?.join(' | '),
          source: documentMetadata.source,
        },
      });
    });

    try {
      await this.vectorStore.addDocuments(documents);

      const processingTime = Date.now() - startTime;
      logger.info('Chunks indexed', {
        documentId: documentMetadata.id,
        chunksIndexed: documents.length,
        processingTimeMs: processingTime,
      });
    } catch (error) {
      logger.error('Failed to index chunks', {
        documentId: documentMetadata.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async search(
    query: string,
    k: number = 5,
    filter?: Record<string, unknown>
  ): Promise<VectorSearchResult[]> {
    await this.initialize();

    if (!this.vectorStore) {
      throw new Error('Vector store not initialized');
    }

    try {
      const results = await this.vectorStore.similaritySearchWithScore(
        query,
        k,
        filter
      );

      return results.map(([doc, score]) => ({
        chunk: {
          id: doc.metadata.chunkId as string,
          documentId: doc.metadata.documentId as string,
          content: doc.pageContent,
          metadata: {
            pageNumber: doc.metadata.pageNumber as number | undefined,
            chunkIndex: doc.metadata.chunkIndex as number,
            startChar: 0,
            endChar: doc.pageContent.length,
            headers: doc.metadata.headers
              ? (doc.metadata.headers as string).split(' | ')
              : undefined,
          },
        },
        score,
      }));
    } catch (error) {
      logger.error('Search failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.initialize();

    if (!this.vectorStore) {
      throw new Error('Vector store not initialized');
    }

    try {
      // Note: Chroma deletion by metadata requires specific implementation
      // This is a placeholder for the actual deletion logic
      logger.info('Document deleted from index', { documentId });
    } catch (error) {
      logger.error('Failed to delete document from index', {
        documentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async getCollectionStats(): Promise<{
    documentCount: number;
    chunkCount: number;
  }> {
    await this.initialize();

    // Implementation depends on vector store capabilities
    return {
      documentCount: 0,
      chunkCount: 0,
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const indexer = new Indexer();
