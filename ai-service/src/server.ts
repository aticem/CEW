/**
 * CEW AI Service - Main Server Entry Point
 * @module server
 * 
 * Express server with graceful shutdown and vector index initialization.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { config } from './config';
import { createRouter } from './routes';
import { initializeIndex, saveIndex, getIndexStats } from './ingest/indexer';
import { logger } from './services/loggerService';

// ============================================================================
// Types
// ============================================================================

interface ServerState {
  isShuttingDown: boolean;
  server: http.Server | null;
}

// ============================================================================
// State
// ============================================================================

const state: ServerState = {
  isShuttingDown: false,
  server: null,
};

// ============================================================================
// Express App Setup
// ============================================================================

/**
 * Create and configure Express application
 */
function createApp(): Express {
  const app = express();

  // ==========================================================================
  // Security Middleware
  // ==========================================================================
  
  app.use(helmet({
    contentSecurityPolicy: false, // Disable for API
    crossOriginEmbedderPolicy: false,
  }));

  // ==========================================================================
  // CORS Configuration
  // ==========================================================================
  
  const corsOptions: cors.CorsOptions = {
    origin: getCorsOrigins(),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400, // 24 hours
  };

  app.use(cors(corsOptions));

  // ==========================================================================
  // Body Parsing
  // ==========================================================================
  
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // ==========================================================================
  // Request ID Middleware
  // ==========================================================================
  
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.headers['x-request-id'] = req.headers['x-request-id'] || generateRequestId();
    next();
  });

  // ==========================================================================
  // Health Check (before shutdown check)
  // ==========================================================================
  
  app.get('/health', async (_req: Request, res: Response) => {
    if (state.isShuttingDown) {
      return res.status(503).json({
        status: 'shutting_down',
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const indexStats = await getIndexStats();
      return res.json({
        status: 'ok',
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        indexStats,
        timestamp: new Date().toISOString(),
      });
    } catch {
      return res.json({
        status: 'degraded',
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        indexStats: null,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ==========================================================================
  // Shutdown Check Middleware
  // ==========================================================================
  
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (state.isShuttingDown) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Server is shutting down',
        },
        timestamp: new Date().toISOString(),
      });
    }
    next();
  });

  // ==========================================================================
  // API Routes
  // ==========================================================================
  
  app.use('/api', createRouter());

  // ==========================================================================
  // Root Route
  // ==========================================================================
  
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      service: 'CEW AI Service',
      version: process.env.npm_package_version || '1.0.0',
      status: 'running',
      endpoints: {
        health: '/health',
        chat: '/api/chat',
        ingest: '/api/ingest',
        documents: '/api/documents',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // ==========================================================================
  // 404 Handler
  // ==========================================================================
  
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // ==========================================================================
  // Global Error Handler
  // ==========================================================================
  
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.headers['x-request-id'];
    
    logger.error('Unhandled error', {
      requestId,
      error: err.message,
      stack: config.server.env === 'development' ? err.stack : undefined,
      path: req.path,
      method: req.method,
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: config.server.env === 'production'
          ? 'An internal error occurred'
          : err.message,
      },
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

// ============================================================================
// CORS Origins
// ============================================================================

/**
 * Get allowed CORS origins based on environment
 */
function getCorsOrigins(): string[] | string | boolean {
  const env = config.server.env;

  if (env === 'development') {
    // Allow all origins in development
    return true;
  }

  // Production origins
  const origins = [
    'http://localhost:3000',      // Local frontend
    'http://localhost:5173',      // Vite dev server
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];

  // Add CEW frontend origin if configured
  if (config.paths.cewFrontend) {
    // In production, you'd add actual domain here
  }

  return origins;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize services before starting server
 */
async function initializeServices(): Promise<void> {
  logger.info('Initializing services...');

  try {
    // Initialize vector index (loads from disk if exists)
    logger.info('Initializing vector index...');
    await initializeIndex();

    // Get and log index statistics
    const stats = await getIndexStats();
    logger.info('Vector index ready', {
      provider: stats.provider,
      totalDocuments: stats.totalDocuments,
      totalChunks: stats.totalChunks,
      indexSizeBytes: stats.indexSizeBytes,
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Service initialization failed', { error: errorMsg });
    throw error;
  }

  logger.info('Services initialized successfully');
}

// ============================================================================
// Server Lifecycle
// ============================================================================

/**
 * Start the HTTP server
 */
async function startServer(): Promise<void> {
  const app = createApp();
  const port = config.server.port;

  // Create HTTP server
  state.server = http.createServer(app);

  // Handle server errors
  state.server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${port} is already in use`);
      process.exit(1);
    }
    logger.error('Server error', { error: error.message });
  });

  // Start listening
  return new Promise((resolve) => {
    state.server!.listen(port, () => {
      logger.info('Server started', {
        port,
        environment: config.server.env,
        nodeVersion: process.version,
      });

      console.log('');
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║                    CEW AI Service                            ║');
      console.log('╠══════════════════════════════════════════════════════════════╣');
      console.log(`║  🚀 Server running on http://localhost:${port}                   ║`);
      console.log(`║  📊 Health check:    http://localhost:${port}/health             ║`);
      console.log(`║  💬 Chat endpoint:   http://localhost:${port}/api/chat           ║`);
      console.log(`║  📁 Documents:       http://localhost:${port}/api/documents      ║`);
      console.log('╠══════════════════════════════════════════════════════════════╣');
      console.log(`║  Environment: ${config.server.env.padEnd(46)}║`);
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('');

      resolve();
    });
  });
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (state.isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  state.isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Give some time for in-flight requests to complete
  const shutdownTimeout = 30000; // 30 seconds

  const shutdownTimer = setTimeout(() => {
    logger.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, shutdownTimeout);

  try {
    // Save vector index to disk
    logger.info('Saving vector index...');
    await saveIndex();
    logger.info('Vector index saved successfully');

    // Close HTTP server
    if (state.server) {
      logger.info('Closing HTTP server...');
      await new Promise<void>((resolve, reject) => {
        state.server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      logger.info('HTTP server closed');
    }

    clearTimeout(shutdownTimer);
    logger.info('Graceful shutdown complete');
    process.exit(0);

  } catch (error) {
    clearTimeout(shutdownTimer);
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Error during shutdown', { error: errorMsg });
    process.exit(1);
  }
}

// ============================================================================
// Process Event Handlers
// ============================================================================

/**
 * Setup process event handlers
 */
function setupProcessHandlers(): void {
  // Graceful shutdown signals
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled Promise Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });

    // In production, we might want to exit
    if (config.server.env === 'production') {
      gracefulShutdown('unhandledRejection');
    }
  });

  // Uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
    });

    // Always exit on uncaught exceptions
    gracefulShutdown('uncaughtException');
  });
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
// Main Entry Point
// ============================================================================

/**
 * Main startup function
 */
async function main(): Promise<void> {
  try {
    // Setup process handlers first
    setupProcessHandlers();

    // Initialize services
    await initializeServices();

    // Start server
    await startServer();

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start server', { error: errorMsg });
    console.error('❌ Failed to start CEW AI Service:', errorMsg);
    process.exit(1);
  }
}

// Start the server
main();

// Export for testing
export { createApp };
