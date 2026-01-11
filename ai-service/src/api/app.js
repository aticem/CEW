import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import config, { validateConfig } from '../config/env.js';
import logger from '../utils/logger.js';
import queryRoutes from './routes/queryRoutes.js';
import ingestRoutes from './routes/ingestRoutes.js';
import healthRoutes from './routes/healthRoutes.js';

// Validate configuration
try {
  validateConfig();
  logger.info('Configuration validated successfully');
} catch (error) {
  logger.error('Configuration validation failed', { error: error.message });
  process.exit(1);
}

// Create Express app
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.maxRequests,
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', limiter);

// Request logging
app.use((req, res, next) => {
  logger.info('HTTP Request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// Routes
app.use('/api', queryRoutes);
app.use('/api', ingestRoutes);
app.use('/', healthRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'CEW AI Service',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      query: 'POST /api/query',
      ingestTrigger: 'POST /api/ingest/trigger',
      ingestStatus: 'GET /api/ingest/status',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    path: req.path,
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// Start server
const PORT = config.port;

app.listen(PORT, '0.0.0.0', () => {
  logger.info('AI Service started', {
    port: PORT,
    nodeEnv: config.nodeEnv,
    vectorDbProvider: config.vectorDb.provider,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

export default app;
