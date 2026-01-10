import express from 'express';
import { processQuery } from '../../query/queryPipeline.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * POST /api/query
 * Process a user question and return answer with sources
 */
router.post('/query', async (req, res) => {
  try {
    const { question, options } = req.body;

    // Validate input
    if (!question) {
      return res.status(400).json({
        success: false,
        error: 'Question is required',
      });
    }

    logger.info('Query API request', { question });

    // Process query
    const result = await processQuery(question, options);

    res.json(result);
  } catch (error) {
    logger.error('Error in query API', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

export default router;
