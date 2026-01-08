import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { IngestRequest, IngestResult, IngestProgress, APIResponse } from '../types';
import { documentLoader } from '../ingest/documentLoader';
import { chunker } from '../ingest/chunker';
import { embedder } from '../ingest/embedder';
import { indexer } from '../ingest/indexer';
import { localDocConnector } from '../connectors/localDocConnector';
import { policyService } from '../services/policyService';
import { config } from '../config';
import { logger } from '../services/logger';

const router = Router();

// Track ingestion progress
const ingestProgress = new Map<string, IngestProgress>();

/**
 * POST /api/ingest
 * Ingest a document from filepath or upload
 */
router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = uuidv4();

  try {
    const { filepath, source = 'upload', tags } = req.body as IngestRequest;

    if (!filepath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FILEPATH',
          message: 'filepath is required',
        },
      });
    }

    // Check if file exists
    try {
      await fs.access(filepath);
    } catch {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'File not found at specified path',
        },
      });
    }

    // Validate file type
    if (!documentLoader.isSupported(filepath)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UNSUPPORTED_FILE_TYPE',
          message: `File type not supported. Supported types: ${documentLoader.getSupportedExtensions().join(', ')}`,
        },
      });
    }

    // Get file info for validation
    const stats = await fs.stat(filepath);
    const filename = path.basename(filepath);

    // Validate file
    const validation = policyService.validateFileUpload(
      filename,
      stats.size,
      getMimeType(filepath)
    );

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'File validation failed',
          details: { violations: validation.violations },
        },
      });
    }

    // Start ingestion
    const documentId = uuidv4();
    ingestProgress.set(documentId, {
      documentId,
      status: 'processing',
      progress: 0,
      message: 'Loading document...',
    });

    // Process asynchronously
    processDocument(documentId, filepath, source, tags)
      .catch((error) => {
        logger.error('Document ingestion failed', {
          documentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        ingestProgress.set(documentId, {
          documentId,
          status: 'failed',
          progress: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    // Return immediately with document ID
    const response: APIResponse<{ documentId: string; status: string }> = {
      success: true,
      data: {
        documentId,
        status: 'processing',
      },
      metadata: {
        requestId,
        processingTimeMs: Date.now() - startTime,
      },
    };

    return res.status(202).json(response);
  } catch (error) {
    logger.error('Ingest request failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred while processing the request',
      },
    });
  }
});

/**
 * GET /api/ingest/progress/:documentId
 * Get ingestion progress for a document
 */
router.get('/progress/:documentId', (req: Request, res: Response) => {
  const { documentId } = req.params;
  const progress = ingestProgress.get(documentId);

  if (!progress) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Document not found or ingestion not started',
      },
    });
  }

  return res.json({
    success: true,
    data: progress,
  });
});

/**
 * POST /api/ingest/scan
 * Scan and ingest all documents in the documents folder
 */
router.post('/scan', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = uuidv4();

  try {
    const result = await localDocConnector.scanAndIngest();

    return res.json({
      success: true,
      data: result,
      metadata: {
        requestId,
        processingTimeMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    logger.error('Scan request failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred during scan',
      },
    });
  }
});

/**
 * GET /api/ingest/documents
 * List all documents in the documents folder
 */
router.get('/documents', async (req: Request, res: Response) => {
  try {
    const documents = await localDocConnector.listDocuments();

    const documentInfo = await Promise.all(
      documents.map(async (filename) => {
        const info = await localDocConnector.getDocumentInfo(filename);
        return {
          filename,
          ...info,
        };
      })
    );

    return res.json({
      success: true,
      data: {
        documents: documentInfo,
        storagePath: localDocConnector.getStoragePath(),
      },
    });
  } catch (error) {
    logger.error('List documents failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to list documents',
      },
    });
  }
});

/**
 * DELETE /api/ingest/documents/:filename
 * Delete a document from storage and index
 */
router.delete('/documents/:filename', async (req: Request, res: Response) => {
  const { filename } = req.params;

  try {
    // Delete from storage
    await localDocConnector.deleteFromStorage(filename);

    // Note: Should also delete from vector index
    // This would require tracking document IDs

    return res.json({
      success: true,
      data: { message: 'Document deleted' },
    });
  } catch (error) {
    logger.error('Delete document failed', {
      filename,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to delete document',
      },
    });
  }
});

// Helper function to process document
async function processDocument(
  documentId: string,
  filepath: string,
  source: string,
  tags?: string[]
): Promise<void> {
  try {
    // Update progress: Loading
    ingestProgress.set(documentId, {
      documentId,
      status: 'processing',
      progress: 10,
      message: 'Loading document...',
    });

    const loadedDoc = await documentLoader.loadDocument(filepath, source as any);

    // Update progress: Chunking
    ingestProgress.set(documentId, {
      documentId,
      status: 'processing',
      progress: 30,
      message: 'Splitting into chunks...',
    });

    const chunks = chunker.chunk(loadedDoc);

    // Update progress: Embedding
    ingestProgress.set(documentId, {
      documentId,
      status: 'embedding',
      progress: 50,
      message: `Generating embeddings for ${chunks.length} chunks...`,
    });

    const embeddingResults = await embedder.embedChunks(chunks);

    // Update progress: Indexing
    ingestProgress.set(documentId, {
      documentId,
      status: 'indexing',
      progress: 80,
      message: 'Indexing in vector store...',
    });

    await indexer.indexChunks(embeddingResults, loadedDoc.metadata);

    // Update progress: Completed
    ingestProgress.set(documentId, {
      documentId,
      status: 'completed',
      progress: 100,
      message: `Successfully processed ${chunks.length} chunks`,
    });

    logger.info('Document ingestion completed', {
      documentId,
      filename: loadedDoc.metadata.filename,
      chunks: chunks.length,
    });
  } catch (error) {
    throw error;
  }
}

// Helper function to get MIME type from filepath
function getMimeType(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

export default router;
