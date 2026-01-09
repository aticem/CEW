/**
 * Main server file - Bootstraps and starts the AI service
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { logger } from './services/logger';
import { vectorStore } from './vector';

// Import routes
import chatRoutes from './routes/chat';
import ingestRoutes from './routes/ingest';
import healthRoutes from './routes/health';

/**
 * Initialize Express application
 */
function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  
  // CORS configuration
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  }));

  // Body parsing middleware
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    next();
  });

  // Mount routes
  app.use('/api/chat', chatRoutes);
  app.use('/api/ingest', ingestRoutes);
  app.use('/api/health', healthRoutes);

  // Root endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      service: 'CEW AI Service',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        chat: 'POST /api/chat',
        ingest: 'POST /api/ingest',
        ingestDirectory: 'POST /api/ingest/directory',
        documents: 'GET /api/ingest/documents',
        deleteDocument: 'DELETE /api/ingest/documents/:documentId',
        health: 'GET /api/health',
        ready: 'GET /api/health/ready',
        live: 'GET /api/health/live'
      }
    });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      path: req.path
    });
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', { error: err, path: req.path });
    res.status(500).json({
      error: 'Internal Server Error',
      message: config.nodeEnv === 'development' ? err.message : 'An error occurred'
    });
  });

  return app;
}

/**
 * Initialize services
 */
async function initializeServices(): Promise<void> {
  logger.info('Initializing services...');

  try {
    // Initialize vector store
    logger.info('Initializing vector store...');
    await vectorStore.initialize();
    logger.info('Vector store initialized successfully');

    // Add more service initializations here if needed

  } catch (error) {
    logger.error('Service initialization failed', { error });
    throw error;
  }
}

/**
 * Start the server
 */
async function start(): Promise<void> {
  try {
    logger.info('Starting CEW AI Service...', {
      nodeEnv: config.nodeEnv,
      port: config.port
    });

    // Initialize services
    await initializeServices();

    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`Server started successfully`, {
        port: config.port,
        nodeEnv: config.nodeEnv,
        pid: process.pid
      });
      logger.info(`API available at http://localhost:${config.port}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Handle uncaught errors
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', { error });
      shutdown();
    });

    process.on('unhandledRejection', (reason: any) => {
      logger.error('Unhandled rejection', { reason });
      shutdown();
    });

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  start();
}

export { createApp, start };
