/**
 * Health Route
 * @module routes/health
 * 
 * Handles health check endpoints.
 * GET /api/health - Service health status
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getIndexStats, IndexStats } from '../ingest/indexer';
import { logger } from '../services/loggerService';

const router = Router();

// ============================================================================
// Constants
// ============================================================================

/** Service start time */
const startTime = Date.now();

/** Service version */
const version = process.env.npm_package_version || '1.0.0';

// ============================================================================
// Types
// ============================================================================

/**
 * Health check response
 */
interface HealthResponse {
  /** Overall status */
  status: 'ok' | 'degraded' | 'error';
  /** Service version */
  version: string;
  /** Uptime in seconds */
  uptime: number;
  /** Index statistics */
  indexStats: IndexStats | null;
  /** Individual service health */
  services: {
    index: boolean;
    llm: boolean;
  };
  /** Timestamp */
  timestamp: string;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/health
 * 
 * Returns service health status including index statistics.
 * 
 * @example
 * Response:
 * {
 *   "status": "ok",
 *   "version": "1.0.0",
 *   "uptime": 3600,
 *   "indexStats": {
 *     "totalChunks": 234,
 *     "totalDocuments": 15,
 *     "indexSizeBytes": 1234567
 *   }
 * }
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    // Try to get index stats
    let indexStats: IndexStats | null = null;
    let indexHealthy = false;

    try {
      indexStats = await getIndexStats();
      indexHealthy = true;
    } catch (error) {
      logger.warn('Failed to get index stats for health check', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Determine overall status
    const status: HealthResponse['status'] = indexHealthy ? 'ok' : 'degraded';

    const response: HealthResponse = {
      status,
      version,
      uptime: uptimeSeconds,
      indexStats,
      services: {
        index: indexHealthy,
        llm: true, // Assume LLM is healthy (checked on actual calls)
      },
      timestamp: new Date().toISOString(),
    };

    const httpStatus = status === 'ok' ? 200 : status === 'degraded' ? 200 : 503;
    return res.status(httpStatus).json(response);

  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/health/ready
 * 
 * Kubernetes readiness probe.
 * Returns 200 if service is ready to accept traffic.
 */
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    // Check if index is initialized
    await getIndexStats();
    
    return res.status(200).json({
      ready: true,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(503).json({
      ready: false,
      reason: 'Index not initialized',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/health/live
 * 
 * Kubernetes liveness probe.
 * Returns 200 if service is alive.
 */
router.get('/live', (_req: Request, res: Response) => {
  return res.status(200).json({
    alive: true,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

export default router;
