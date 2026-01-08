import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateConfig } from './config';
import { logger } from './services/logger';
import { indexer } from './ingest/indexer';
import { localDocConnector } from './connectors/localDocConnector';

// Route imports
import chatRoutes from './routes/chat';
import ingestRoutes from './routes/ingest';
import healthRoutes from './routes/health';

const app: Express = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      userAgent: req.get('user-agent'),
    });
  });

  next();
});

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/ingest', ingestRoutes);
app.use('/api/health', healthRoutes);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'CEW AI Service',
    version: '1.0.0',
    description: 'RAG-based AI Assistant for Construction Engineering Workflow',
    endpoints: {
      chat: '/api/chat',
      ingest: '/api/ingest',
      health: '/api/health',
    },
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.path} not found`,
    },
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: config.nodeEnv === 'production'
        ? 'An internal error occurred'
        : err.message,
    },
  });
});

// Startup function
async function start(): Promise<void> {
  try {
    // Validate configuration
    validateConfig();
    logger.info('Configuration validated');

    // Initialize services
    logger.info('Initializing services...');

    // Initialize local document connector
    await localDocConnector.initialize();

    // Initialize vector store (will connect on first use if not here)
    try {
      await indexer.initialize();
      logger.info('Vector store connected');
    } catch (error) {
      logger.warn('Vector store initialization failed - will retry on first use', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Start file watcher for auto-ingestion (optional)
    if (config.nodeEnv === 'development') {
      localDocConnector.startWatching(async (filepath) => {
        try {
          await localDocConnector.ingestDocument(filepath);
        } catch (error) {
          logger.error('Auto-ingest failed', {
            filepath,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });
    }

    // Start server
    app.listen(config.port, () => {
      logger.info(`CEW AI Service started`, {
        port: config.port,
        environment: config.nodeEnv,
        vectorStore: config.vectorStore.type,
        llmModel: config.openai.model,
      });

      console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    CEW AI Service                         ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${config.port}                ║
║  Environment: ${config.nodeEnv.padEnd(42)}║
║                                                           ║
║  Endpoints:                                               ║
║    POST /api/chat          - Chat with documents          ║
║    POST /api/ingest        - Ingest a document            ║
║    GET  /api/health        - Health check                 ║
║                                                           ║
║  Documentation: /api/health/detailed                      ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });

  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  localDocConnector.stopWatching();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  localDocConnector.stopWatching();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

// Start the server
start();

export default app;
