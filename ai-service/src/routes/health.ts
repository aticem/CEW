import { Router, Request, Response } from 'express';
import { HealthStatus, ServiceHealth } from '../types';
import { indexer } from '../ingest/indexer';
import { llmService } from '../services/llmService';
import { ocrService } from '../services/ocrService';
import { config } from '../config';
import { logger } from '../services/logger';

const router = Router();

const startTime = Date.now();

/**
 * GET /api/health
 * Basic health check endpoint
 */
router.get('/', async (req: Request, res: Response) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  // Quick check - just return basic status
  const response = {
    status: 'healthy',
    version: process.env.npm_package_version || '1.0.0',
    uptime,
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  };

  return res.json(response);
});

/**
 * GET /api/health/detailed
 * Detailed health check with service status
 */
router.get('/detailed', async (req: Request, res: Response) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  // Check all services
  const [vectorStoreHealth, llmHealth, ocrHealth] = await Promise.all([
    checkVectorStore(),
    checkLLM(),
    checkOCR(),
  ]);

  // Determine overall status
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (vectorStoreHealth.status === 'down' || llmHealth.status === 'down') {
    overallStatus = 'unhealthy';
  } else if (
    vectorStoreHealth.status === 'degraded' ||
    llmHealth.status === 'degraded' ||
    ocrHealth.status === 'degraded'
  ) {
    overallStatus = 'degraded';
  }

  const response: HealthStatus = {
    status: overallStatus,
    version: process.env.npm_package_version || '1.0.0',
    uptime,
    services: {
      vectorStore: vectorStoreHealth,
      llm: llmHealth,
      ocr: ocrHealth,
    },
  };

  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  logger.debug('Health check completed', {
    status: overallStatus,
    services: {
      vectorStore: vectorStoreHealth.status,
      llm: llmHealth.status,
      ocr: ocrHealth.status,
    },
  });

  return res.status(statusCode).json(response);
});

/**
 * GET /api/health/ready
 * Readiness probe for Kubernetes
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Check if critical services are ready
    const vectorStoreReady = indexer.isInitialized();

    if (vectorStoreReady) {
      return res.json({ ready: true });
    } else {
      return res.status(503).json({
        ready: false,
        message: 'Services not ready',
      });
    }
  } catch {
    return res.status(503).json({
      ready: false,
      message: 'Health check failed',
    });
  }
});

/**
 * GET /api/health/live
 * Liveness probe for Kubernetes
 */
router.get('/live', (req: Request, res: Response) => {
  // Simple liveness check - just verify the process is running
  return res.json({ alive: true });
});

// Helper functions for service health checks
async function checkVectorStore(): Promise<ServiceHealth> {
  const startTime = Date.now();

  try {
    // Check if initialized
    const isInitialized = indexer.isInitialized();

    if (!isInitialized) {
      // Try to initialize
      await indexer.initialize();
    }

    return {
      status: 'up',
      latencyMs: Date.now() - startTime,
      lastCheck: new Date(),
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - startTime,
      lastCheck: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkLLM(): Promise<ServiceHealth> {
  const startTime = Date.now();

  try {
    const isHealthy = await llmService.checkHealth();

    return {
      status: isHealthy ? 'up' : 'down',
      latencyMs: Date.now() - startTime,
      lastCheck: new Date(),
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - startTime,
      lastCheck: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkOCR(): Promise<ServiceHealth> {
  const startTime = Date.now();

  try {
    // OCR is optional, so "down" when disabled is still okay
    if (!ocrService.isEnabled()) {
      return {
        status: 'up',
        latencyMs: 0,
        lastCheck: new Date(),
      };
    }

    const isHealthy = await ocrService.checkHealth();

    return {
      status: isHealthy ? 'up' : 'degraded',
      latencyMs: Date.now() - startTime,
      lastCheck: new Date(),
    };
  } catch (error) {
    return {
      status: 'degraded',
      latencyMs: Date.now() - startTime,
      lastCheck: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default router;
