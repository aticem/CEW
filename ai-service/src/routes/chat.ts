import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  QueryRequest,
  QueryResult,
  ChatMessage,
  ChatConversation,
  APIResponse,
} from '../types';
import { queryClassifier } from '../query/queryClassifier';
import { retriever } from '../query/retriever';
import { responseGenerator } from '../query/responseGenerator';
import { policyService } from '../services/policyService';
import { logger } from '../services/logger';

const router = Router();

// In-memory conversation store (replace with database in production)
const conversations = new Map<string, ChatConversation>();

/**
 * POST /api/chat
 * Handle chat queries with RAG-based document Q&A
 */
router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = uuidv4();

  try {
    const { query, conversationId, filters, maxResults } = req.body as QueryRequest;

    // Validate input
    const validation = policyService.validateQuery(query);
    if (!validation.isValid) {
      const response: APIResponse<null> = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query validation failed',
          details: { violations: validation.violations },
        },
        metadata: {
          requestId,
          processingTimeMs: Date.now() - startTime,
        },
      };
      return res.status(400).json(response);
    }

    // Get or create conversation
    let conversation = conversationId ? conversations.get(conversationId) : null;
    if (!conversation) {
      conversation = {
        id: conversationId || uuidv4(),
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      conversations.set(conversation.id, conversation);
    }

    // Add user message to conversation
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: query,
      timestamp: new Date(),
    };
    conversation.messages.push(userMessage);

    // Classify query type
    const classification = queryClassifier.classify(query);

    let result: QueryResult;

    if (classification.queryType === 'conversational') {
      // Handle conversational queries without RAG
      result = await responseGenerator.generateConversational(
        query,
        conversation.messages.slice(0, -1) // Exclude current message
      );
    } else {
      // Retrieve relevant documents
      const retrievalResult = await retriever.retrieve(query, {
        maxResults: maxResults || 5,
        filters,
      });

      // Generate response
      result = await responseGenerator.generate(
        query,
        classification.queryType,
        retrievalResult,
        {
          conversationHistory: conversation.messages.slice(0, -1),
        }
      );
    }

    // Add assistant message to conversation
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: result.answer,
      timestamp: new Date(),
      sources: result.sources,
    };
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = new Date();

    // Prepare response
    const response: APIResponse<{
      answer: string;
      sources: typeof result.sources;
      queryType: string;
      confidence: number;
      conversationId: string;
    }> = {
      success: true,
      data: {
        answer: result.answer,
        sources: result.sources,
        queryType: result.queryType,
        confidence: result.confidence,
        conversationId: conversation.id,
      },
      metadata: {
        requestId,
        processingTimeMs: Date.now() - startTime,
      },
    };

    logger.info('Chat request completed', {
      requestId,
      conversationId: conversation.id,
      queryType: classification.queryType,
      processingTimeMs: Date.now() - startTime,
    });

    return res.json(response);
  } catch (error) {
    logger.error('Chat request failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    const response: APIResponse<null> = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred while processing your request',
      },
      metadata: {
        requestId,
        processingTimeMs: Date.now() - startTime,
      },
    };

    return res.status(500).json(response);
  }
});

/**
 * GET /api/chat/conversations/:id
 * Get conversation history
 */
router.get('/conversations/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const conversation = conversations.get(id);

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Conversation not found',
      },
    });
  }

  return res.json({
    success: true,
    data: conversation,
  });
});

/**
 * DELETE /api/chat/conversations/:id
 * Delete a conversation
 */
router.delete('/conversations/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  if (conversations.has(id)) {
    conversations.delete(id);
    return res.json({
      success: true,
      data: { message: 'Conversation deleted' },
    });
  }

  return res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Conversation not found',
    },
  });
});

/**
 * POST /api/chat/stream
 * Stream chat responses (SSE)
 */
router.post('/stream', async (req: Request, res: Response) => {
  const { query, conversationId, filters } = req.body as QueryRequest;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Validate input
    const validation = policyService.validateQuery(query);
    if (!validation.isValid) {
      res.write(`data: ${JSON.stringify({ error: 'Validation failed' })}\n\n`);
      res.end();
      return;
    }

    // Classify and retrieve
    const classification = queryClassifier.classify(query);
    const retrievalResult = await retriever.retrieve(query, { filters });

    // Send sources first
    res.write(`data: ${JSON.stringify({ type: 'sources', data: retrievalResult.sources })}\n\n`);

    // Stream would be implemented here with LLM streaming
    // For now, generate full response
    const result = await responseGenerator.generate(
      query,
      classification.queryType,
      retrievalResult
    );

    res.write(`data: ${JSON.stringify({ type: 'content', data: result.answer })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', data: 'Processing failed' })}\n\n`);
    res.end();
  }
});

export default router;
