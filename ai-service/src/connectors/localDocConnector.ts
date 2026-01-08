import fs from 'fs/promises';
import path from 'path';
import { watch, FSWatcher } from 'fs';
import { DocumentMetadata, DocumentSource } from '../types';
import { documentLoader } from '../ingest/documentLoader';
import { chunker } from '../ingest/chunker';
import { embedder } from '../ingest/embedder';
import { indexer } from '../ingest/indexer';
import { config } from '../config';
import { logger } from '../services/logger';

export interface ScanResult {
  total: number;
  processed: number;
  failed: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

class LocalDocConnector {
  private documentsPath: string;
  private watcher: FSWatcher | null = null;
  private processedFiles: Set<string> = new Set();

  constructor() {
    this.documentsPath = config.documents.storagePath;
  }

  async initialize(): Promise<void> {
    // Ensure documents directory exists
    try {
      await fs.mkdir(this.documentsPath, { recursive: true });
      logger.info('Local document connector initialized', {
        path: this.documentsPath,
      });
    } catch (error) {
      logger.error('Failed to initialize documents directory', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async scanAndIngest(): Promise<ScanResult> {
    const result: ScanResult = {
      total: 0,
      processed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    const files = await this.listDocuments();
    result.total = files.length;

    for (const file of files) {
      const filepath = path.join(this.documentsPath, file);

      if (this.processedFiles.has(filepath)) {
        result.skipped++;
        continue;
      }

      try {
        await this.ingestDocument(filepath);
        this.processedFiles.add(filepath);
        result.processed++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          file,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error('Failed to ingest document', {
          file,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Scan and ingest completed', result);
    return result;
  }

  async ingestDocument(filepath: string): Promise<DocumentMetadata> {
    const startTime = Date.now();

    // Load document
    const loadedDoc = await documentLoader.loadDocument(filepath, 'local');

    // Chunk document
    const chunks = chunker.chunk(loadedDoc);

    // Generate embeddings
    const embeddingResults = await embedder.embedChunks(chunks);

    // Index in vector store
    await indexer.indexChunks(embeddingResults, loadedDoc.metadata);

    const processingTime = Date.now() - startTime;
    logger.info('Document ingested', {
      documentId: loadedDoc.metadata.id,
      filename: loadedDoc.metadata.filename,
      chunks: chunks.length,
      processingTimeMs: processingTime,
    });

    return loadedDoc.metadata;
  }

  async listDocuments(): Promise<string[]> {
    const entries = await fs.readdir(this.documentsPath, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile())
      .filter((entry) => documentLoader.isSupported(entry.name))
      .map((entry) => entry.name);
  }

  async getDocumentInfo(filename: string): Promise<{
    exists: boolean;
    size?: number;
    modified?: Date;
  }> {
    const filepath = path.join(this.documentsPath, filename);

    try {
      const stats = await fs.stat(filepath);
      return {
        exists: true,
        size: stats.size,
        modified: stats.mtime,
      };
    } catch {
      return { exists: false };
    }
  }

  startWatching(onNewFile: (filepath: string) => void): void {
    if (this.watcher) {
      logger.warn('File watcher already running');
      return;
    }

    this.watcher = watch(this.documentsPath, async (eventType, filename) => {
      if (!filename || eventType !== 'rename') return;

      const filepath = path.join(this.documentsPath, filename);

      try {
        const stats = await fs.stat(filepath);
        if (stats.isFile() && documentLoader.isSupported(filename)) {
          logger.info('New document detected', { filename });
          onNewFile(filepath);
        }
      } catch {
        // File was deleted or doesn't exist
      }
    });

    logger.info('File watcher started', { path: this.documentsPath });
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('File watcher stopped');
    }
  }

  async copyToStorage(sourcePath: string): Promise<string> {
    const filename = path.basename(sourcePath);
    const destPath = path.join(this.documentsPath, filename);

    await fs.copyFile(sourcePath, destPath);
    logger.info('Document copied to storage', { filename });

    return destPath;
  }

  async deleteFromStorage(filename: string): Promise<void> {
    const filepath = path.join(this.documentsPath, filename);
    await fs.unlink(filepath);
    this.processedFiles.delete(filepath);
    logger.info('Document deleted from storage', { filename });
  }

  getStoragePath(): string {
    return this.documentsPath;
  }
}

export const localDocConnector = new LocalDocConnector();
