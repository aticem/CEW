import express from 'express';
import { ingestDocuments } from '../../ingest/ingestPipeline.js';
import * as vectorDb from '../../vector/vectorDbClient.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// Track ingest status
let ingestStatus = {
  isRunning: false,
  lastRun: null,
  stats: null,
  error: null,
};

/**
 * POST /api/ingest/trigger
 * Trigger document ingestion manually
 */
router.post('/ingest/trigger', async (req, res) => {
  try {
    if (ingestStatus.isRunning) {
      return res.status(409).json({
        success: false,
        error: 'Ingest is already running',
        status: ingestStatus,
      });
    }

    logger.info('Manual ingest triggered');

    // Start ingest in background
    ingestStatus.isRunning = true;
    ingestStatus.error = null;

    // Don't await - let it run in background
    ingestDocuments()
      .then((result) => {
        ingestStatus.isRunning = false;
        ingestStatus.lastRun = new Date().toISOString();
        ingestStatus.stats = result.stats;
        ingestStatus.error = result.error || null;

        logger.info('Ingest completed', { stats: result.stats });
      })
      .catch((error) => {
        ingestStatus.isRunning = false;
        ingestStatus.error = error.message;

        logger.error('Ingest failed', { error: error.message });
      });

    res.json({
      success: true,
      message: 'Ingest started',
      status: ingestStatus,
    });
  } catch (error) {
    logger.error('Error triggering ingest', {
      error: error.message,
      stack: error.stack,
    });

    ingestStatus.isRunning = false;
    ingestStatus.error = error.message;

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /api/ingest/status
 * Get current ingest status
 */
router.get('/ingest/status', async (req, res) => {
  try {
    // Get collection info
    const collectionInfo = await vectorDb.getCollectionInfo();

    res.json({
      success: true,
      status: ingestStatus,
      collection: collectionInfo,
    });
  } catch (error) {
    logger.error('Error getting ingest status', {
      error: error.message,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

export default router;
