/**
 * Ingest Pipeline - Orchestrates the complete document ingestion process
 */
import fs from 'fs/promises';
import path from 'path';
import { IngestionResult, ParsedDocument } from '../types';
import { logger } from '../services/logger';
import { documentLoader, DocumentLoader } from './documentLoader';
import { textChunker } from './chunker';
import { embedder } from './embedder';
import { vectorStore } from '../vector';
import { config } from '../config';

/**
 * Document registry management
 */
interface DocumentRegistry {
  documents: Array<{
    id: string;
    filename: string;
    filepath: string;
    fileType: string;
    ingestedAt: string;
    chunkCount: number;
  }>;
}

/**
 * Ingest Pipeline class
 */
export class IngestPipeline {
  private registryPath: string;

  constructor() {
    this.registryPath = config.registryPath;
  }

  /**
   * Ingest a single document
   * @param filepath - Path to the document file
   * @returns Ingestion result
   */
  async ingestDocument(filepath: string): Promise<IngestionResult> {
    const startTime = Date.now();
    const warnings: string[] = [];

    try {
      logger.info(`Starting document ingestion: ${filepath}`);

      // Step 1: Load and parse document
      logger.info('Step 1: Loading document...');
      const parsedDoc: ParsedDocument = await documentLoader.loadDocument(filepath);
      
      if (parsedDoc.warnings) {
        warnings.push(...parsedDoc.warnings);
      }

      // Step 2: Chunk document
      logger.info('Step 2: Chunking document...');
      const chunks = textChunker.chunkDocument(parsedDoc);
      
      if (chunks.length === 0) {
        throw new Error('Document chunking produced no chunks');
      }

      // Step 3: Generate embeddings
      logger.info('Step 3: Generating embeddings...');
      const embeddedChunks = await embedder.embedChunks(chunks);

      // Step 4: Store in vector database
      logger.info('Step 4: Storing in vector database...');
      await vectorStore.addChunks(embeddedChunks);

      // Step 5: Update registry
      logger.info('Step 5: Updating document registry...');
      await this.addToRegistry({
        id: parsedDoc.metadata.id,
        filename: parsedDoc.metadata.filename,
        filepath: parsedDoc.metadata.filepath,
        fileType: parsedDoc.metadata.fileType,
        ingestedAt: parsedDoc.metadata.ingestedAt.toISOString(),
        chunkCount: embeddedChunks.length
      });

      const processingTime = Date.now() - startTime;

      logger.info('Document ingestion completed successfully', {
        filename: parsedDoc.metadata.filename,
        documentId: parsedDoc.metadata.id,
        chunks: embeddedChunks.length,
        processingTime: `${processingTime}ms`
      });

      return {
        success: true,
        documentId: parsedDoc.metadata.id,
        metadata: parsedDoc.metadata,
        chunksCreated: embeddedChunks.length,
        processingTime,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error(`Document ingestion failed: ${filepath}`, { error });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        chunksCreated: 0,
        processingTime,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    }
  }

  /**
   * Ingest multiple documents from a directory
   * @param dirPath - Path to directory containing documents
   * @returns Array of ingestion results
   */
  async ingestDirectory(dirPath: string): Promise<IngestionResult[]> {
    logger.info(`Starting directory ingestion: ${dirPath}`);

    try {
      // Read directory
      const files = await fs.readdir(dirPath);
      
      // Filter for supported file types
      const supportedFiles = files.filter(file => 
        DocumentLoader.isSupportedFile(file)
      );

      logger.info(`Found ${supportedFiles.length} supported documents in directory`);

      if (supportedFiles.length === 0) {
        logger.warn('No supported documents found in directory');
        return [];
      }

      // Ingest each file
      const results: IngestionResult[] = [];
      for (const file of supportedFiles) {
        const filepath = path.join(dirPath, file);
        const result = await this.ingestDocument(filepath);
        results.push(result);
      }

      // Summary
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      logger.info('Directory ingestion completed', {
        total: results.length,
        successful,
        failed
      });

      return results;

    } catch (error) {
      logger.error(`Directory ingestion failed: ${dirPath}`, { error });
      throw error;
    }
  }

  /**
   * Delete a document and its chunks from the system
   * @param documentId - The document ID to delete
   */
  async deleteDocument(documentId: string): Promise<void> {
    logger.info(`Deleting document: ${documentId}`);

    try {
      // Delete from vector store
      await vectorStore.deleteByDocumentId(documentId);

      // Remove from registry
      await this.removeFromRegistry(documentId);

      logger.info(`Document deleted successfully: ${documentId}`);
    } catch (error) {
      logger.error(`Failed to delete document: ${documentId}`, { error });
      throw error;
    }
  }

  /**
   * Get list of ingested documents
   */
  async getDocumentList(): Promise<DocumentRegistry['documents']> {
    try {
      const registry = await this.loadRegistry();
      return registry.documents;
    } catch (error) {
      logger.error('Failed to load document list', { error });
      return [];
    }
  }

  /**
   * Load the document registry
   */
  private async loadRegistry(): Promise<DocumentRegistry> {
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // Registry doesn't exist yet, return empty
      return { documents: [] };
    }
  }

  /**
   * Save the document registry
   */
  private async saveRegistry(registry: DocumentRegistry): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.registryPath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(
      this.registryPath,
      JSON.stringify(registry, null, 2),
      'utf-8'
    );
  }

  /**
   * Add document to registry
   */
  private async addToRegistry(doc: DocumentRegistry['documents'][0]): Promise<void> {
    const registry = await this.loadRegistry();
    
    // Remove if already exists (re-ingestion)
    registry.documents = registry.documents.filter(d => d.id !== doc.id);
    
    // Add new entry
    registry.documents.push(doc);
    
    await this.saveRegistry(registry);
  }

  /**
   * Remove document from registry
   */
  private async removeFromRegistry(documentId: string): Promise<void> {
    const registry = await this.loadRegistry();
    registry.documents = registry.documents.filter(d => d.id !== documentId);
    await this.saveRegistry(registry);
  }
}

// Singleton instance
export const ingestPipeline = new IngestPipeline();
export default ingestPipeline;
