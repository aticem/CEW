/**
 * Ingest Route
 * @module routes/ingest
 * 
 * Handles document ingestion endpoints.
 * POST /api/ingest - Trigger document ingestion pipeline
 */

import { Router, Request, Response, NextFunction } from 'express';
import { IngestResult } from '../types';
import { loadAllDocuments } from '../ingest/documentLoader';
import { chunkAllDocuments } from '../ingest/chunker';
import { embedChunks } from '../ingest/embedder';
import { initializeIndex, addToIndex, saveIndex, getIndexStats, resetIndex } from '../ingest/indexer';
import { config } from '../config';
import { logger } from '../services/loggerService';

const router = Router();

// ============================================================================
// Types
// ============================================================================

/**
 * Ingest request body
 */
interface IngestRequestBody {
  /** Force reindexing of all documents */
  forceReindex?: boolean;
  /** Specific directory to ingest (optional, defaults to config) */
  directory?: string;
  /** Category to assign to documents */
  category?: string;
}

/**
 * Ingest response
 */
interface IngestResponse {
  success: boolean;
  data?: IngestResult;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

// ============================================================================
// State
// ============================================================================

/** Track if ingestion is currently running */
let isIngesting = false;
let lastIngestionTime: Date | null = null;

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /api/ingest
 * 
 * Trigger the document ingestion pipeline.
 * This is a long-running operation.
 * 
 * @example
 * Request:
 * {
 *   "forceReindex": true
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "documentsProcessed": 15,
 *     "chunksCreated": 234,
 *     "tokensEmbedded": 45000,
 *     "durationMs": 12345,
 *     "errors": []
 *   }
 * }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  // Prevent concurrent ingestion
  if (isIngesting) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'INGESTION_IN_PROGRESS',
        message: 'Document ingestion is already in progress. Please wait for it to complete.',
      },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    isIngesting = true;

    const body = req.body as IngestRequestBody;
    const forceReindex = body.forceReindex ?? false;
    const directory = body.directory || config.paths.documents;
    const category = body.category || 'local_documents';

    logger.info('Starting document ingestion', {
      directory,
      forceReindex,
      category,
    });

    // Initialize index (reset if force reindex)
    if (forceReindex) {
      logger.info('Force reindex requested - resetting index');
      await resetIndex();
    }
    await initializeIndex();

    // Step 1: Load documents
    logger.info('Loading documents from directory', { directory });
    const parsedDocuments = await loadAllDocuments(directory, {
      recursive: true,
      category,
    });

    if (parsedDocuments.length === 0) {
      logger.warn('No documents found to ingest', { directory });
      
      const result: IngestResult = {
        success: true,
        documentsProcessed: 0,
        chunksCreated: 0,
        tokensEmbedded: 0,
        durationMs: Date.now() - startTime,
        errors: [],
      };

      isIngesting = false;
      lastIngestionTime = new Date();

      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      } as IngestResponse);
    }

    logger.info('Documents loaded', { count: parsedDocuments.length });

    // Step 2: Chunk documents
    logger.info('Chunking documents');
    const chunkedDocuments = chunkAllDocuments(parsedDocuments);
    
    const totalChunks = chunkedDocuments.reduce((sum, doc) => sum + doc.chunks.length, 0);
    logger.info('Documents chunked', { totalChunks });

    // Step 3: Embed chunks
    logger.info('Generating embeddings');
    const allChunks = chunkedDocuments.flatMap(doc => doc.chunks);
    const embeddedChunks = await embedChunks(allChunks);
    
    const tokensEmbedded = embeddedChunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0);
    logger.info('Embeddings generated', { 
      chunks: embeddedChunks.length,
      tokens: tokensEmbedded,
    });

    // Step 4: Add to index
    logger.info('Adding chunks to index');
    await addToIndex(embeddedChunks);
    await saveIndex();
    logger.info('Chunks indexed successfully');

    // Build result
    const durationMs = Date.now() - startTime;
    const result: IngestResult = {
      success: true,
      documentsProcessed: parsedDocuments.length,
      chunksCreated: totalChunks,
      tokensEmbedded,
      durationMs,
      errors: [],
    };

    isIngesting = false;
    lastIngestionTime = new Date();

    logger.info('Ingestion completed', {
      documentsProcessed: result.documentsProcessed,
      chunksCreated: result.chunksCreated,
      tokensEmbedded: result.tokensEmbedded,
      durationMs: result.durationMs,
    });

    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    } as IngestResponse);

  } catch (error) {
    isIngesting = false;
    next(error);
  }
});

/**
 * GET /api/ingest/status
 * 
 * Get current ingestion status
 */
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getIndexStats();

    return res.json({
      success: true,
      data: {
        isIngesting,
        lastIngestionTime: lastIngestionTime?.toISOString() || null,
        indexStats: stats,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/ingest/qaqc
 * 
 * Ingest QAQC documents from CEW frontend
 */
router.post('/qaqc', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  if (isIngesting) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'INGESTION_IN_PROGRESS',
        message: 'Document ingestion is already in progress.',
      },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    isIngesting = true;

    const qaqcPath = config.paths.cewQAQC;
    logger.info('Starting QAQC document ingestion', { path: qaqcPath });

    await initializeIndex();

    // Load QAQC documents
    const parsedDocuments = await loadAllDocuments(qaqcPath, {
      recursive: true,
      category: 'qaqc',
      tags: ['qaqc', 'checklist'],
    });

    if (parsedDocuments.length === 0) {
      isIngesting = false;
      return res.json({
        success: true,
        data: {
          success: true,
          documentsProcessed: 0,
          chunksCreated: 0,
          tokensEmbedded: 0,
          durationMs: Date.now() - startTime,
          errors: [],
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Process pipeline
    const chunkedDocuments = chunkAllDocuments(parsedDocuments);
    const allChunks = chunkedDocuments.flatMap(doc => doc.chunks);
    const embeddedChunks = await embedChunks(allChunks);
    await addToIndex(embeddedChunks);
    await saveIndex();

    const result: IngestResult = {
      success: true,
      documentsProcessed: parsedDocuments.length,
      chunksCreated: allChunks.length,
      tokensEmbedded: embeddedChunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0),
      durationMs: Date.now() - startTime,
      errors: [],
    };

    isIngesting = false;
    lastIngestionTime = new Date();

    logger.info('QAQC ingestion completed', result);

    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    isIngesting = false;
    next(error);
  }
});

export default router;
