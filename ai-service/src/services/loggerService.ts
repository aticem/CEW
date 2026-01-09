/**
 * Logger Service Module
 * Centralized logging using Winston
 */

import winston from 'winston';
import path from 'path';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  return msg;
});

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  defaultMeta: { service: 'cew-ai-service' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      ),
    }),
  ],
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  const logDir = process.env.LOG_FILE 
    ? path.dirname(process.env.LOG_FILE) 
    : './logs';
  
  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
    })
  );
  
  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
    })
  );
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Log request/response for debugging
 */
export function logRequest(
  method: string,
  path: string,
  body?: unknown,
  query?: unknown
): void {
  logger.debug('Incoming request', { method, path, body, query });
}

/**
 * Log LLM interactions
 */
export function logLLMCall(
  model: string,
  promptTokens: number,
  completionTokens: number,
  duration: number
): void {
  logger.info('LLM call completed', {
    model,
    promptTokens,
    completionTokens,
    duration,
  });
}

/**
 * Log retrieval operations
 */
export function logRetrieval(
  query: string,
  resultsCount: number,
  topScore: number,
  duration: number
): void {
  logger.info('Retrieval completed', {
    queryPreview: query.substring(0, 100),
    resultsCount,
    topScore,
    duration,
  });
}

/**
 * Log ingestion operations
 */
export function logIngestion(
  filename: string,
  chunksCreated: number,
  duration: number
): void {
  logger.info('Document ingested', {
    filename,
    chunksCreated,
    duration,
  });
}

export default {
  logger,
  createChildLogger,
  logRequest,
  logLLMCall,
  logRetrieval,
  logIngestion,
};
