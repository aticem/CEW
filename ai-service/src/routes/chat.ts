/**
 * Chat API routes
 */
import { Router, Request, Response } from 'express';
import { ChatRequest } from '../types';
import { responseGenerator } from '../query/responseGenerator';
import { logger } from '../services/logger';

const router = Router();

/**
 * POST /api/chat
 * Handle chat queries
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const request: ChatRequest = req.body;

    // Validate request
    if (!request.query || typeof request.query !== 'string') {
      return res.status(400).json({
        error: 'Invalid request: query field is required and must be a string'
      });
    }

    if (request.query.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid request: query cannot be empty'
      });
    }

    logger.info('Received chat request', {
      queryLength: request.query.length,
      userId: request.userId,
      conversationId: request.conversationId
    });

    // Generate response
    const response = await responseGenerator.generateResponse(request);

    // Return response
    res.json(response);

  } catch (error) {
    logger.error('Chat endpoint error', { error });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
