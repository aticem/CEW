import express from 'express';
import * as vectorDb from '../../vector/vectorDbClient.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'cew-ai-service',
      version: '1.0.0',
    };

    // Check vector database health
    try {
      const vectorDbHealth = await vectorDb.healthCheck();
      health.vectorDb = vectorDbHealth;
    } catch (error) {
      health.vectorDb = {
        status: 'unhealthy',
        error: error.message,
      };
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check error', {
      error: error.message,
    });

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

export default router;
