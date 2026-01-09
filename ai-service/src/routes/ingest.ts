/**
 * Ingest API routes
 */
import { Router, Request, Response } from 'express';
import { ingestPipeline } from '../ingest';
import { logger } from '../services/logger';

const router = Router();

/**
 * POST /api/ingest
 * Ingest a single document
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { filepath } = req.body;

    // Validate request
    if (!filepath || typeof filepath !== 'string') {
      res.status(400).json({
        error: 'Invalid request: filepath is required and must be a string'
      });
      return;
    }

    logger.info('Received ingest request', { filepath });

    // Ingest document
    const result = await ingestPipeline.ingestDocument(filepath);

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }

  } catch (error) {
    logger.error('Ingest endpoint error', { error });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/ingest/directory
 * Ingest all documents from a directory
 */
router.post('/directory', async (req: Request, res: Response): Promise<void> => {
  try {
    const { dirPath } = req.body;

    // Validate request
    if (!dirPath || typeof dirPath !== 'string') {
      res.status(400).json({
        error: 'Invalid request: dirPath is required and must be a string'
      });
      return;
    }

    logger.info('Received directory ingest request', { dirPath });

    // Ingest directory
    const results = await ingestPipeline.ingestDirectory(dirPath);

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      total: results.length,
      successful,
      failed,
      results
    });

  } catch (error) {
    logger.error('Directory ingest endpoint error', { error });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/ingest/documents
 * Get list of ingested documents
 */
router.get('/documents', async (_req: Request, res: Response): Promise<void> => {
  try {
    const documents = await ingestPipeline.getDocumentList();
    res.json({ documents });
  } catch (error) {
    logger.error('Get documents endpoint error', { error });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/ingest/documents/:documentId
 * Delete a document and its chunks
 */
router.delete('/documents/:documentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { documentId } = req.params;

    if (!documentId) {
      res.status(400).json({
        error: 'Invalid request: documentId is required'
      });
      return;
    }

    logger.info('Received delete document request', { documentId });

    await ingestPipeline.deleteDocument(documentId);

    res.json({
      success: true,
      message: `Document ${documentId} deleted successfully`
    });

  } catch (error) {
    logger.error('Delete document endpoint error', { error });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
