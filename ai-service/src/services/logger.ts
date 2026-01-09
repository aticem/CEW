import winston from 'winston';

const { combine, timestamp, printf, colorize, json } = winston.format;

/**
 * Custom console format for development
 */
const consoleFormat = printf(({ level, message, timestamp, service, ...metadata }) => {
  let metaString = '';
  if (Object.keys(metadata).length > 0) {
    metaString = ` ${JSON.stringify(metadata)}`;
  }
  return `${timestamp} [${level}]: ${message}${metaString}`;
});

/**
 * Determine log level from environment
 */
const logLevel = process.env.LOG_LEVEL || 'info';

/**
 * Determine if we're in production
 */
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Winston logger instance configured for the CEW AI Service
 *
 * Log levels (in order of priority):
 * - error: Error conditions
 * - warn: Warning conditions
 * - info: Informational messages
 * - debug: Debug-level messages
 *
 * @example
 * ```typescript
 * import { logger } from './services/logger';
 *
 * logger.info('Document loaded', { documentId: '123', filename: 'test.pdf' });
 * logger.error('Failed to process', { error: err.message });
 * ```
 */
export const logger = winston.createLogger({
  level: logLevel,
  format: isProduction
    ? combine(timestamp(), json())
    : combine(timestamp(), colorize(), consoleFormat),
  transports: [
    new winston.transports.Console(),
  ],
  defaultMeta: { service: 'cew-ai-service' },
});

// Add file transports in production
if (isProduction) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
    })
  );
}

export default logger;
