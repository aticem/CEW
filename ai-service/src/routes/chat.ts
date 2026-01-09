/**
 * Chat API routes
 */
import { Router, Request, Response } from 'express';
import { ChatRequest, ChatResponse, QueryType } from '../types';
import { responseGenerator } from '../query/responseGenerator';
import { logger } from '../services/logger';

const router = Router();

/**
 * Normalize ChatResponse to ensure ALL required fields are present
 * CRITICAL: Frontend expects a complete ChatResponse structure
 */
function normalizeChatResponse(response: Partial<ChatResponse>, startTime: number): ChatResponse {
  return {
    answer: typeof response.answer === 'string' ? response.answer : 'Sorry, I couldn\'t process your question.',
    sources: Array.isArray(response.sources) ? response.sources : [],
    queryType: response.queryType || QueryType.OUT_OF_SCOPE,
    language: response.language || 'en',
    confidence: typeof response.confidence === 'number' ? response.confidence : 0,
    processingTime: typeof response.processingTime === 'number' ? response.processingTime : (Date.now() - startTime),
    tokenUsage: response.tokenUsage,
    warnings: response.warnings
  };
}

/**
 * POST /api/chat
 * Handle chat queries
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  
  try {
    const request: ChatRequest = req.body;

    // Validate request
    if (!request.query || typeof request.query !== 'string') {
      const errorResponse: ChatResponse = {
        answer: 'Invalid request: Please provide a valid question.',
        sources: [],
        queryType: QueryType.OUT_OF_SCOPE,
        language: request.language || 'en',
        confidence: 0,
        processingTime: Date.now() - startTime,
        warnings: ['Invalid request format']
      };
      res.status(200).json(errorResponse);
      return;
    }

    if (request.query.trim().length === 0) {
      const errorResponse: ChatResponse = {
        answer: 'Please ask a question.',
        sources: [],
        queryType: QueryType.OUT_OF_SCOPE,
        language: request.language || 'en',
        confidence: 0,
        processingTime: Date.now() - startTime,
        warnings: ['Empty query']
      };
      res.status(200).json(errorResponse);
      return;
    }

    logger.info('Received chat request', {
      queryLength: request.query.length,
      userId: request.userId,
      conversationId: request.conversationId
    });

    // Generate response - responseGenerator MUST always return a valid ChatResponse
    const response = await responseGenerator.generateResponse(request);

    // Normalize response to ensure ALL required fields are present
    const normalizedResponse = normalizeChatResponse(response, startTime);

    // Log final response for debugging
    logger.debug('Sending normalized response', {
      hasAnswer: !!normalizedResponse.answer,
      hasSources: Array.isArray(normalizedResponse.sources),
      queryType: normalizedResponse.queryType,
      language: normalizedResponse.language
    });

    // Always return HTTP 200 with complete ChatResponse structure
    res.status(200).json(normalizedResponse);

  } catch (error) {
    // Log the full error with stack trace
    logger.error('Chat endpoint critical error', { 
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      query: req.body?.query
    });

    // NEVER send error objects to client - always return valid ChatResponse
    const fallbackResponse: ChatResponse = {
      answer: 'Sorry, I couldn\'t process your question. Please try again or contact support if the issue persists.',
      sources: [],
      queryType: QueryType.OUT_OF_SCOPE,
      language: req.body?.language || 'en',
      confidence: 0,
      processingTime: Date.now() - startTime,
      warnings: ['Processing error occurred']
    };

    // Normalize and return
    const normalizedFallback = normalizeChatResponse(fallbackResponse, startTime);
    res.status(200).json(normalizedFallback);
  }
});

export default router;
