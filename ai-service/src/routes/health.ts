/**
 * Health check API routes
 */
import { Router, Request, Response } from 'express';
import { HealthResponse } from '../types';
import { vectorStore } from '../vector';
import { embedder } from '../ingest/embedder';
import { logger } from '../services/logger';

const router = Router();

// Track server start time
const startTime = Date.now();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Check vector store connection
    const vectorStoreConnected = await vectorStore.isConnected();
    const vectorStats = vectorStoreConnected 
      ? await vectorStore.getStats()
      : { totalChunks: 0, uniqueDocuments: 0 };

    // Check OpenAI connection
    const openaiConnected = await embedder.testConnection();

    // Calculate uptime
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    // Determine overall status
    const status: 'healthy' | 'unhealthy' = 
      (vectorStoreConnected && openaiConnected) ? 'healthy' : 'unhealthy';

    const healthResponse: HealthResponse = {
      status,
      timestamp: new Date(),
      vectorStore: {
        connected: vectorStoreConnected,
        documentCount: vectorStats.uniqueDocuments,
        chunkCount: vectorStats.totalChunks
      },
      openai: {
        connected: openaiConnected
      },
      uptime
    };

    const statusCode = status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthResponse);

  } catch (error) {
    logger.error('Health check error', { error });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/health/ready
 * Readiness probe
 */
router.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  try {
    const vectorStoreConnected = await vectorStore.isConnected();
    
    if (vectorStoreConnected) {
      res.status(200).json({ ready: true });
    } else {
      res.status(503).json({ ready: false, reason: 'Vector store not connected' });
    }
  } catch (error) {
    res.status(503).json({ ready: false, reason: 'Service not ready' });
  }
});

/**
 * GET /api/health/live
 * Liveness probe
 */
router.get('/live', (_req: Request, res: Response): void => {
  res.status(200).json({ alive: true });
});

export default router;
