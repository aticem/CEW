/**
 * Routes Index
 * @module routes
 * 
 * Central router registration with middleware.
 * Exports configured Express router with all API routes.
 */

import { Router, Request, Response, NextFunction } from 'express';
import chatRouter from './chat';
import ingestRouter from './ingest';
import healthRouter from './health';
import documentsRouter from './documents';
import cewSnapshotRouter from './cewSnapshot';
import qaqcSnapshotRouter from './qaqcSnapshot';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * API Error response
 */
interface APIErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

/**
 * Extended Error with status code
 */
interface HTTPError extends Error {
  statusCode?: number;
  code?: string;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Request logging middleware
 * Logs all incoming requests with timing
 */
function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = generateRequestId();

  // Attach request ID for tracing
  (req as Request & { requestId: string }).requestId = requestId;

  // Log request
  logger.info('Incoming request', {
    requestId,
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('Request completed', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });

  next();
}

/**
 * Error handling middleware
 * Catches all errors and returns formatted JSON response
 */
function errorHandler(
  err: HTTPError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as Request & { requestId?: string }).requestId;

  // Determine status code
  let statusCode = err.statusCode || 500;
  let errorCode = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
  } else if (err.message?.includes('not found')) {
    statusCode = 404;
    errorCode = 'NOT_FOUND';
  }

  // Log error
  logger.error('Request error', {
    requestId,
    method: req.method,
    path: req.path,
    statusCode,
    errorCode,
    message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Send error response
  const response: APIErrorResponse = {
    success: false,
    error: {
      code: errorCode,
      message: process.env.NODE_ENV === 'production' && statusCode === 500
        ? 'An internal error occurred'
        : message,
      details: process.env.NODE_ENV === 'development' ? { stack: err.stack } : undefined,
    },
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(response);
}

/**
 * 404 handler for unknown routes
 */
function notFoundHandler(req: Request, res: Response): void {
  const response: APIErrorResponse = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
    timestamp: new Date().toISOString(),
  };

  res.status(404).json(response);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Router Setup
// ============================================================================

/**
 * Create and configure the main API router
 */
export function createRouter(): Router {
  const router = Router();

  // Apply request logging to all routes
  router.use(requestLogger);

  // Mount route handlers
  router.use('/chat', chatRouter);
  router.use('/ingest', ingestRouter);
  router.use('/health', healthRouter);
  router.use('/documents', documentsRouter);
  router.use('/cew/snapshot', cewSnapshotRouter);
  router.use('/qaqc/snapshot', qaqcSnapshotRouter);

  // 404 handler for unknown API routes
  router.use(notFoundHandler);

  // Error handler (must be last)
  router.use(errorHandler);

  return router;
}

// Export individual routers for testing
export {
  chatRouter,
  ingestRouter,
  healthRouter,
  documentsRouter,
  cewSnapshotRouter,
  qaqcSnapshotRouter,
  requestLogger,
  errorHandler,
  notFoundHandler,
};

export default createRouter;
