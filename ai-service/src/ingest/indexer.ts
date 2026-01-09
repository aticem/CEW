/**
 * Vector Indexer Module
 * @module ingest/indexer
 * 
 * Manages vector index storage and retrieval.
 * Supports ChromaDB with fallback to local file-based storage.
 * Uses singleton pattern for index management.
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { ChromaClient, Collection } from 'chromadb';
import { DocumentChunk, DocumentMetadata } from '../types';
import { config } from '../config';
import { logger } from '../services/loggerService';
import { cosineSimilarity } from './embedder';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);

// ============================================================================
// Types
// ============================================================================

/**
 * Indexer configuration options
 */
export interface IndexerOptions {
  /** Collection/index name */
  collectionName: string;
  /** Path to persist index data */
  persistPath: string;
  /** Distance metric for similarity */
  distanceMetric: 'cosine' | 'euclidean' | 'ip';
  /** Use ChromaDB (false = local file storage) */
  useChroma: boolean;
  /** ChromaDB host */
  chromaHost: string;
  /** ChromaDB port */
  chromaPort: number;
}

/**
 * Document registry entry
 */
export interface DocumentRegistryEntry {
  /** Document ID */
  id: string;
  /** Document filename */
  filename: string;
  /** File path */
  filePath: string;
  /** Number of chunks */
  chunkCount: number;
  /** Chunk IDs belonging to this document */
  chunkIds: string[];
  /** When document was indexed */
  indexedAt: string;
  /** Content hash for change detection */
  contentHash?: string;
  /** Document metadata */
  metadata?: Partial<DocumentMetadata>;
}

/**
 * Index statistics
 */
export interface IndexStats {
  /** Total number of chunks in index */
  totalChunks: number;
  /** Total number of documents */
  totalDocuments: number;
  /** Estimated index size in bytes */
  indexSizeBytes: number;
  /** Index creation time */
  createdAt?: string;
  /** Last update time */
  lastUpdatedAt?: string;
  /** Storage provider being used */
  provider: 'chromadb' | 'local';
}

/**
 * Search result from index
 */
export interface SearchResult {
  /** Retrieved chunks */
  chunks: DocumentChunk[];
  /** Similarity scores (0-1, higher = more similar) */
  scores: number[];
  /** Search metadata */
  metadata: {
    queryTimeMs: number;
    totalSearched: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: IndexerOptions = {
  collectionName: config.vectorStore.collectionName || 'cew_documents',
  persistPath: config.paths.indexStore || './index-store',
  distanceMetric: 'cosine',
  useChroma: config.vectorStore.provider === 'chromadb',
  chromaHost: config.vectorStore.chromaHost || 'localhost',
  chromaPort: config.vectorStore.chromaPort || 8000,
};

const REGISTRY_FILENAME = 'documents-registry.json';
const CHUNKS_FILENAME = 'chunks-store.json';
const VECTORS_FILENAME = 'vectors-store.json';

// ============================================================================
// Singleton State
// ============================================================================

/** Singleton indexer instance */
let instance: VectorIndexer | null = null;

/**
 * Vector Indexer class (singleton)
 */
class VectorIndexer {
  private options: IndexerOptions;
  private isInitialized: boolean = false;
  private chromaClient: ChromaClient | null = null;
  private chromaCollection: Collection | null = null;
  
  // Local storage fallback
  private documentRegistry: Map<string, DocumentRegistryEntry> = new Map();
  private chunksStore: Map<string, DocumentChunk> = new Map();
  private vectorsStore: Map<string, number[]> = new Map();
  
  private createdAt: string | null = null;
  private lastUpdatedAt: string | null = null;

  constructor(options: IndexerOptions) {
    this.options = options;
  }

  /**
   * Initialize the index
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Index already initialized');
      return;
    }

    logger.info('Initializing vector index', {
      collectionName: this.options.collectionName,
      persistPath: this.options.persistPath,
      useChroma: this.options.useChroma,
    });

    // Ensure persist directory exists
    await this.ensureDirectory(this.options.persistPath);

    // Try ChromaDB first if configured
    if (this.options.useChroma) {
      try {
        await this.initializeChroma();
        logger.info('ChromaDB initialized successfully');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn('ChromaDB initialization failed, falling back to local storage', {
          error: errorMsg,
        });
        await this.initializeLocal();
      }
    } else {
      await this.initializeLocal();
    }

    this.isInitialized = true;
    this.createdAt = this.createdAt || new Date().toISOString();
    
    const stats = await this.getStats();
    logger.info('Vector index ready', {
      provider: this.chromaCollection ? 'chromadb' : 'local',
      totalChunks: stats.totalChunks,
      totalDocuments: stats.totalDocuments,
    });
  }

  /**
   * Initialize ChromaDB connection
   */
  private async initializeChroma(): Promise<void> {
    this.chromaClient = new ChromaClient({
      path: `http://${this.options.chromaHost}:${this.options.chromaPort}`,
    });

    // Get or create collection
    this.chromaCollection = await this.chromaClient.getOrCreateCollection({
      name: this.options.collectionName,
      metadata: {
        'hnsw:space': this.options.distanceMetric === 'cosine' ? 'cosine' : 'l2',
      },
    });

    // Load document registry
    await this.loadRegistry();
  }

  /**
   * Initialize local file-based storage
   */
  private async initializeLocal(): Promise<void> {
    await this.loadRegistry();
    await this.loadLocalStore();
    logger.info('Local vector storage initialized');
  }

  /**
   * Add chunks to the index
   */
  async add(chunks: DocumentChunk[]): Promise<void> {
    this.ensureInitialized();

    if (chunks.length === 0) {
      return;
    }

    // Validate all chunks have embeddings
    const validChunks = chunks.filter(chunk => {
      if (!chunk.embedding || chunk.embedding.length === 0) {
        logger.warn('Chunk missing embedding, skipping', { chunkId: chunk.id });
        return false;
      }
      return true;
    });

    if (validChunks.length === 0) {
      logger.warn('No valid chunks to add (all missing embeddings)');
      return;
    }

    logger.debug('Adding chunks to index', { count: validChunks.length });

    if (this.chromaCollection) {
      await this.addToChroma(validChunks);
    } else {
      await this.addToLocal(validChunks);
    }

    // Update document registry
    await this.updateRegistry(validChunks);
    
    this.lastUpdatedAt = new Date().toISOString();
    
    logger.info('Chunks added to index', {
      count: validChunks.length,
      documentIds: [...new Set(validChunks.map(c => c.documentId))],
    });
  }

  /**
   * Add chunks to ChromaDB
   */
  private async addToChroma(chunks: DocumentChunk[]): Promise<void> {
    if (!this.chromaCollection) throw new Error('ChromaDB not initialized');

    const ids = chunks.map(c => c.id);
    const embeddings = chunks.map(c => c.embedding!);
    const documents = chunks.map(c => c.content);
    const metadatas = chunks.map(c => ({
      documentId: c.documentId,
      chunkIndex: c.chunkIndex,
      pageNumber: c.pageNumber || 0,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
    }));

    await this.chromaCollection.upsert({
      ids,
      embeddings,
      documents,
      metadatas,
    });
  }

  /**
   * Add chunks to local storage
   */
  private async addToLocal(chunks: DocumentChunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunksStore.set(chunk.id, chunk);
      this.vectorsStore.set(chunk.id, chunk.embedding!);
    }
    await this.saveLocalStore();
  }

  /**
   * Remove document and its chunks from index
   */
  async remove(documentId: string): Promise<void> {
    this.ensureInitialized();

    const registryEntry = this.documentRegistry.get(documentId);
    if (!registryEntry) {
      logger.warn('Document not found in registry', { documentId });
      return;
    }

    logger.debug('Removing document from index', {
      documentId,
      chunkCount: registryEntry.chunkCount,
    });

    if (this.chromaCollection) {
      await this.chromaCollection.delete({
        ids: registryEntry.chunkIds,
      });
    } else {
      for (const chunkId of registryEntry.chunkIds) {
        this.chunksStore.delete(chunkId);
        this.vectorsStore.delete(chunkId);
      }
      await this.saveLocalStore();
    }

    // Remove from registry
    this.documentRegistry.delete(documentId);
    await this.saveRegistry();

    this.lastUpdatedAt = new Date().toISOString();

    logger.info('Document removed from index', {
      documentId,
      chunksRemoved: registryEntry.chunkCount,
    });
  }

  /**
   * Search for similar chunks
   */
  async search(
    queryEmbedding: number[],
    topK: number = 5,
    filters?: { documentIds?: string[]; category?: string }
  ): Promise<SearchResult> {
    this.ensureInitialized();
    const startTime = Date.now();

    let chunks: DocumentChunk[] = [];
    let scores: number[] = [];

    if (this.chromaCollection) {
      const result = await this.searchChroma(queryEmbedding, topK, filters);
      chunks = result.chunks;
      scores = result.scores;
    } else {
      const result = await this.searchLocal(queryEmbedding, topK, filters);
      chunks = result.chunks;
      scores = result.scores;
    }

    return {
      chunks,
      scores,
      metadata: {
        queryTimeMs: Date.now() - startTime,
        totalSearched: this.chromaCollection 
          ? (await this.chromaCollection.count()) 
          : this.chunksStore.size,
      },
    };
  }

  /**
   * Search ChromaDB
   */
  private async searchChroma(
    queryEmbedding: number[],
    topK: number,
    filters?: { documentIds?: string[] }
  ): Promise<{ chunks: DocumentChunk[]; scores: number[] }> {
    if (!this.chromaCollection) throw new Error('ChromaDB not initialized');

    const whereFilter = filters?.documentIds 
      ? { documentId: { $in: filters.documentIds } }
      : undefined;

    const results = await this.chromaCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      where: whereFilter as Record<string, unknown>,
    });

    const chunks: DocumentChunk[] = [];
    const scores: number[] = [];

    if (results.ids[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        const id = results.ids[0][i];
        const metadata = results.metadatas?.[0]?.[i] as Record<string, unknown> | undefined;
        const document = results.documents?.[0]?.[i];
        const distance = results.distances?.[0]?.[i];

        chunks.push({
          id,
          documentId: String(metadata?.documentId || ''),
          content: document || '',
          chunkIndex: Number(metadata?.chunkIndex || 0),
          pageNumber: Number(metadata?.pageNumber || undefined),
          startOffset: Number(metadata?.startOffset || 0),
          endOffset: Number(metadata?.endOffset || 0),
        });

        // Convert distance to similarity score (1 - distance for cosine)
        scores.push(distance !== undefined ? 1 - distance : 0);
      }
    }

    return { chunks, scores };
  }

  /**
   * Search local storage
   */
  private async searchLocal(
    queryEmbedding: number[],
    topK: number,
    filters?: { documentIds?: string[] }
  ): Promise<{ chunks: DocumentChunk[]; scores: number[] }> {
    const results: Array<{ chunk: DocumentChunk; score: number }> = [];

    for (const [chunkId, vector] of this.vectorsStore.entries()) {
      const chunk = this.chunksStore.get(chunkId);
      if (!chunk) continue;

      // Apply filters
      if (filters?.documentIds && !filters.documentIds.includes(chunk.documentId)) {
        continue;
      }

      const score = cosineSimilarity(queryEmbedding, vector);
      results.push({ chunk, score });
    }

    // Sort by score descending and take topK
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return {
      chunks: topResults.map(r => r.chunk),
      scores: topResults.map(r => r.score),
    };
  }

  /**
   * Get index statistics
   */
  async getStats(): Promise<IndexStats> {
    this.ensureInitialized();

    let totalChunks = 0;

    if (this.chromaCollection) {
      totalChunks = await this.chromaCollection.count();
    } else {
      totalChunks = this.chunksStore.size;
    }

    // Calculate approximate index size
    let indexSizeBytes = 0;
    if (this.chromaCollection) {
      // Estimate: each embedding is ~6KB (1536 * 4 bytes)
      indexSizeBytes = totalChunks * 6144;
    } else {
      // Calculate actual local storage size
      const registryPath = path.join(this.options.persistPath, REGISTRY_FILENAME);
      const chunksPath = path.join(this.options.persistPath, CHUNKS_FILENAME);
      const vectorsPath = path.join(this.options.persistPath, VECTORS_FILENAME);
      
      for (const filePath of [registryPath, chunksPath, vectorsPath]) {
        if (fs.existsSync(filePath)) {
          indexSizeBytes += fs.statSync(filePath).size;
        }
      }
    }

    return {
      totalChunks,
      totalDocuments: this.documentRegistry.size,
      indexSizeBytes,
      createdAt: this.createdAt || undefined,
      lastUpdatedAt: this.lastUpdatedAt || undefined,
      provider: this.chromaCollection ? 'chromadb' : 'local',
    };
  }

  /**
   * Save index to disk
   */
  async save(): Promise<void> {
    this.ensureInitialized();
    
    await this.saveRegistry();
    
    if (!this.chromaCollection) {
      await this.saveLocalStore();
    }

    logger.info('Index saved to disk', {
      path: this.options.persistPath,
    });
  }

  /**
   * Check if document exists in index
   */
  hasDocument(documentId: string): boolean {
    return this.documentRegistry.has(documentId);
  }

  /**
   * Get document registry entry
   */
  getDocumentEntry(documentId: string): DocumentRegistryEntry | undefined {
    return this.documentRegistry.get(documentId);
  }

  /**
   * Get all document entries
   */
  getAllDocuments(): DocumentRegistryEntry[] {
    return Array.from(this.documentRegistry.values());
  }

  /**
   * Register document metadata (to be called before/during addToIndex)
   */
  registerMetadata(
    documentId: string,
    metadata: {
      filename: string;
      filePath: string;
      fileType?: string;
      sizeBytes?: number;
      pageCount?: number;
      title?: string;
      category?: string;
      contentHash?: string;
    }
  ): void {
    const existing = this.documentRegistry.get(documentId);
    
    if (existing) {
      // Update existing entry with metadata
      existing.filename = metadata.filename;
      existing.filePath = metadata.filePath;
      existing.contentHash = metadata.contentHash;
      existing.metadata = {
        ...existing.metadata,
        fileType: metadata.fileType,
        sizeBytes: metadata.sizeBytes,
        pageCount: metadata.pageCount,
        title: metadata.title,
        category: metadata.category,
      };
      logger.debug('Updated document metadata in registry', { documentId, filename: metadata.filename });
    } else {
      // Create new entry with metadata
      this.documentRegistry.set(documentId, {
        id: documentId,
        filename: metadata.filename,
        filePath: metadata.filePath,
        chunkCount: 0,
        chunkIds: [],
        indexedAt: new Date().toISOString(),
        contentHash: metadata.contentHash,
        metadata: {
          fileType: metadata.fileType,
          sizeBytes: metadata.sizeBytes,
          pageCount: metadata.pageCount,
          title: metadata.title,
          category: metadata.category,
        },
      });
      logger.debug('Registered new document metadata', { documentId, filename: metadata.filename });
    }
  }

  /**
   * Clear all persisted data (registry, local stores, ChromaDB collection)
   */
  async clearAllData(): Promise<void> {
    // Clear ChromaDB collection if available
    if (this.chromaCollection && this.chromaClient) {
      try {
        await this.chromaClient.deleteCollection({ name: this.options.collectionName });
        this.chromaCollection = null;
        logger.info('ChromaDB collection deleted', { collectionName: this.options.collectionName });
      } catch (error) {
        logger.warn('Failed to delete ChromaDB collection', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Clear local stores
    this.documentRegistry.clear();
    this.chunksStore.clear();
    this.vectorsStore.clear();

    // Delete persisted files
    const filesToDelete = [REGISTRY_FILENAME, CHUNKS_FILENAME, VECTORS_FILENAME];
    for (const filename of filesToDelete) {
      const filePath = path.join(this.options.persistPath, filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          logger.debug('Deleted persisted file', { filePath });
        } catch (error) {
          logger.warn('Failed to delete file', { 
            filePath, 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      }
    }

    this.createdAt = null;
    this.lastUpdatedAt = null;
    this.isInitialized = false;
    
    logger.info('All index data cleared');
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Index not initialized. Call initialize() first.');
    }
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
    }
  }

  private async loadRegistry(): Promise<void> {
    const registryPath = path.join(this.options.persistPath, REGISTRY_FILENAME);
    
    if (fs.existsSync(registryPath)) {
      try {
        const data = await readFile(registryPath, 'utf-8');
        const parsed = JSON.parse(data);
        
        this.documentRegistry = new Map(
          parsed.documents.map((doc: DocumentRegistryEntry) => [doc.id, doc])
        );
        this.createdAt = parsed.createdAt;
        this.lastUpdatedAt = parsed.lastUpdatedAt;
        
        logger.debug('Loaded document registry', {
          documentCount: this.documentRegistry.size,
        });
      } catch (error) {
        logger.warn('Failed to load registry, starting fresh', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.documentRegistry = new Map();
      }
    }
  }

  private async saveRegistry(): Promise<void> {
    const registryPath = path.join(this.options.persistPath, REGISTRY_FILENAME);
    
    const data = {
      version: 1,
      createdAt: this.createdAt,
      lastUpdatedAt: this.lastUpdatedAt,
      documents: Array.from(this.documentRegistry.values()),
    };

    await writeFile(registryPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async loadLocalStore(): Promise<void> {
    const chunksPath = path.join(this.options.persistPath, CHUNKS_FILENAME);
    const vectorsPath = path.join(this.options.persistPath, VECTORS_FILENAME);

    // Load chunks
    if (fs.existsSync(chunksPath)) {
      try {
        const data = await readFile(chunksPath, 'utf-8');
        const chunks: DocumentChunk[] = JSON.parse(data);
        this.chunksStore = new Map(chunks.map(c => [c.id, c]));
      } catch (error) {
        logger.warn('Failed to load chunks store', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Load vectors
    if (fs.existsSync(vectorsPath)) {
      try {
        const data = await readFile(vectorsPath, 'utf-8');
        const vectors: Array<{ id: string; vector: number[] }> = JSON.parse(data);
        this.vectorsStore = new Map(vectors.map(v => [v.id, v.vector]));
      } catch (error) {
        logger.warn('Failed to load vectors store', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.debug('Loaded local store', {
      chunks: this.chunksStore.size,
      vectors: this.vectorsStore.size,
    });
  }

  private async saveLocalStore(): Promise<void> {
    const chunksPath = path.join(this.options.persistPath, CHUNKS_FILENAME);
    const vectorsPath = path.join(this.options.persistPath, VECTORS_FILENAME);

    // Save chunks (without embeddings to avoid duplication)
    const chunksData = Array.from(this.chunksStore.values()).map(c => ({
      ...c,
      embedding: undefined, // Don't duplicate embeddings
    }));
    await writeFile(chunksPath, JSON.stringify(chunksData), 'utf-8');

    // Save vectors separately (more efficient for large embeddings)
    const vectorsData = Array.from(this.vectorsStore.entries()).map(([id, vector]) => ({
      id,
      vector,
    }));
    await writeFile(vectorsPath, JSON.stringify(vectorsData), 'utf-8');
  }

  private async updateRegistry(chunks: DocumentChunk[]): Promise<void> {
    // Group chunks by document
    const byDocument = new Map<string, DocumentChunk[]>();
    
    for (const chunk of chunks) {
      const existing = byDocument.get(chunk.documentId) || [];
      existing.push(chunk);
      byDocument.set(chunk.documentId, existing);
    }

    // Update registry entries
    for (const [documentId, docChunks] of byDocument.entries()) {
      const existing = this.documentRegistry.get(documentId);
      const chunkIds = docChunks.map(c => c.id);

      if (existing) {
        // Merge chunk IDs, preserve existing metadata
        const allChunkIds = [...new Set([...existing.chunkIds, ...chunkIds])];
        existing.chunkIds = allChunkIds;
        existing.chunkCount = allChunkIds.length;
        existing.indexedAt = new Date().toISOString();
        // Note: filename, filePath, and metadata are preserved
      } else {
        // Create new entry - metadata should have been registered first via registerMetadata
        logger.warn('Creating registry entry without metadata - call registerDocumentMetadata first', { documentId });
        this.documentRegistry.set(documentId, {
          id: documentId,
          filename: 'Unknown', // Fallback - should be set via registerMetadata
          filePath: '',
          chunkCount: chunkIds.length,
          chunkIds,
          indexedAt: new Date().toISOString(),
        });
      }
    }

    await this.saveRegistry();
  }
}

// ============================================================================
// Public API (Singleton)
// ============================================================================

/**
 * Initialize the vector index
 * @param options - Indexer configuration
 */
export async function initializeIndex(
  options: Partial<IndexerOptions> = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  if (!instance) {
    instance = new VectorIndexer(opts);
  }
  
  await instance.initialize();
}

/**
 * Add chunks to the index
 * @param chunks - Document chunks with embeddings
 */
export async function addToIndex(chunks: DocumentChunk[]): Promise<void> {
  if (!instance) {
    await initializeIndex();
  }
  await instance!.add(chunks);
}

/**
 * Remove a document and its chunks from the index
 * @param documentId - ID of document to remove
 */
export async function removeFromIndex(documentId: string): Promise<void> {
  if (!instance) {
    await initializeIndex();
  }
  await instance!.remove(documentId);
}

/**
 * Search the index for similar chunks
 * @param queryEmbedding - Query vector
 * @param topK - Number of results to return
 * @param filters - Optional filters
 */
export async function searchIndex(
  queryEmbedding: number[],
  topK: number = 5,
  filters?: { documentIds?: string[]; category?: string }
): Promise<SearchResult> {
  if (!instance) {
    await initializeIndex();
  }
  return instance!.search(queryEmbedding, topK, filters);
}

/**
 * Save index to disk
 */
export async function saveIndex(): Promise<void> {
  if (!instance) {
    logger.warn('No index to save');
    return;
  }
  await instance.save();
}

/**
 * Get index statistics
 */
export async function getIndexStats(): Promise<IndexStats> {
  if (!instance) {
    await initializeIndex();
  }
  return instance!.getStats();
}

/**
 * Check if a document exists in the index
 */
export function hasDocument(documentId: string): boolean {
  return instance?.hasDocument(documentId) ?? false;
}

/**
 * Get document registry entry
 */
export function getDocumentEntry(documentId: string): DocumentRegistryEntry | undefined {
  return instance?.getDocumentEntry(documentId);
}

/**
 * Get all indexed documents
 */
export function getAllDocuments(): DocumentRegistryEntry[] {
  return instance?.getAllDocuments() ?? [];
}

/**
 * Register document metadata in the registry
 * Call this before or alongside addToIndex to ensure metadata is stored
 * @param documentId - Document ID
 * @param metadata - Document metadata to register
 */
export function registerDocumentMetadata(
  documentId: string,
  metadata: {
    filename: string;
    filePath: string;
    fileType?: string;
    sizeBytes?: number;
    pageCount?: number;
    title?: string;
    category?: string;
    contentHash?: string;
  }
): void {
  if (!instance) {
    logger.warn('Cannot register metadata - index not initialized');
    return;
  }
  
  instance.registerMetadata(documentId, metadata);
}

/**
 * Reset the index (for testing)
 * @param clearPersistedData - If true, also clear persisted registry and storage files
 */
export async function resetIndex(clearPersistedData: boolean = false): Promise<void> {
  if (instance && clearPersistedData) {
    // Clear the ChromaDB collection if available
    try {
      await instance.clearAllData();
    } catch (error) {
      logger.warn('Failed to clear persisted data', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
  instance = null;
  logger.info('Index reset', { clearedData: clearPersistedData });
}

// ============================================================================
// Exports
// ============================================================================

export default {
  initializeIndex,
  addToIndex,
  removeFromIndex,
  searchIndex,
  saveIndex,
  getIndexStats,
  hasDocument,
  getDocumentEntry,
  getAllDocuments,
  registerDocumentMetadata,
  resetIndex,
  DEFAULT_OPTIONS,
};
