/**
 * Chat Route
 * @module routes/chat
 * 
 * Handles AI chat/query endpoints.
 * POST /api/chat - Main chat endpoint
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ChatRequest, ChatResponse } from '../types';
import { processQuery } from '../query/responseGenerator';
import { logger } from '../services/loggerService';

const router = Router();

// ============================================================================
// Types
// ============================================================================

/**
 * Chat request body
 */
interface ChatRequestBody {
  message: string;
  sessionId?: string;
  queryType?: 'document' | 'data' | 'hybrid';
  maxSources?: number;
  filters?: {
    categories?: string[];
    documentIds?: string[];
  };
}

/**
 * Validation error
 */
interface ValidationError {
  field: string;
  message: string;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate chat request body
 */
function validateChatRequest(body: unknown): { valid: boolean; errors: ValidationError[]; data?: ChatRequestBody } {
  const errors: ValidationError[] = [];

  if (!body || typeof body !== 'object') {
    errors.push({ field: 'body', message: 'Request body is required' });
    return { valid: false, errors };
  }

  const data = body as Record<string, unknown>;

  // Message is required
  if (!data.message) {
    errors.push({ field: 'message', message: 'Message is required' });
  } else if (typeof data.message !== 'string') {
    errors.push({ field: 'message', message: 'Message must be a string' });
  } else if (data.message.trim().length === 0) {
    errors.push({ field: 'message', message: 'Message cannot be empty' });
  }

  // SessionId is optional but must be string if provided
  if (data.sessionId !== undefined && typeof data.sessionId !== 'string') {
    errors.push({ field: 'sessionId', message: 'SessionId must be a string' });
  }

  // QueryType is optional but must be valid if provided
  if (data.queryType !== undefined) {
    const validTypes = ['document', 'data', 'hybrid'];
    if (!validTypes.includes(data.queryType as string)) {
      errors.push({ field: 'queryType', message: `QueryType must be one of: ${validTypes.join(', ')}` });
    }
  }

  // MaxSources is optional but must be positive number
  if (data.maxSources !== undefined) {
    if (typeof data.maxSources !== 'number' || data.maxSources < 1 || data.maxSources > 20) {
      errors.push({ field: 'maxSources', message: 'MaxSources must be a number between 1 and 20' });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      message: (data.message as string).trim(),
      sessionId: data.sessionId as string | undefined,
      queryType: data.queryType as ChatRequestBody['queryType'],
      maxSources: data.maxSources as number | undefined,
      filters: data.filters as ChatRequestBody['filters'],
    },
  };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /api/chat
 * 
 * Send a message to the AI assistant and receive a response.
 * 
 * @example
 * Request:
 * {
 *   "message": "What is the acceptance criteria for DC cables?",
 *   "sessionId": "session_123"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "According to the QAQC documentation...",
 *   "conversationId": "conv_abc",
 *   "sources": [...],
 *   "queryType": "document",
 *   "confidence": 0.85
 * }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    // Validate request body
    const validation = validateChatRequest(req.body);
    
    if (!validation.valid || !validation.data) {
      logger.warn('Chat request validation failed', { errors: validation.errors });
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: validation.errors,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const { message, sessionId, queryType, maxSources, filters } = validation.data;

    logger.info('Chat request received', {
      messagePreview: message.substring(0, 100),
      sessionId,
      queryType,
    });

    // Build ChatRequest for processQuery
    const chatRequest: ChatRequest = {
      message,
      conversationId: sessionId,
      queryType,
      maxSources,
      filters,
    };

    // Process the query
    const response: ChatResponse = await processQuery(chatRequest);

    // Log completion
    const processingTime = Date.now() - startTime;
    logger.info('Chat request completed', {
      conversationId: response.conversationId,
      queryType: response.queryType,
      success: response.success,
      processingTimeMs: processingTime,
    });

    // Return response
    return res.status(response.success ? 200 : 500).json(response);

  } catch (error) {
    // Pass to error handler
    next(error);
  }
});

/**
 * POST /api/chat/stream
 * 
 * Stream a response from the AI assistant (SSE).
 * Currently not implemented - returns error.
 */
router.post('/stream', async (req: Request, res: Response) => {
  // Validate request
  const validation = validateChatRequest(req.body);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: validation.errors,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Streaming not yet implemented
  return res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Streaming responses are not yet implemented',
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
