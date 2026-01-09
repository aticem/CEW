/**
 * Configuration module - loads and validates environment variables
 */
import dotenv from 'dotenv';
import path from 'path';
import { AppConfig } from '../types';
import { logger } from '../services/logger';

// Load environment variables
dotenv.config();

/**
 * Validate required environment variables
 */
function validateConfig(): void {
  const required = ['OPENAI_API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Validate OpenAI API key format
  if (!process.env.OPENAI_API_KEY?.startsWith('sk-')) {
    logger.warn('OpenAI API key does not start with "sk-" - this may be invalid');
  }
}

/**
 * Parse integer from environment variable with default
 */
function getInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse float from environment variable with default
 */
function getFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Application configuration object
 */
export const config: AppConfig = {
  // Server
  port: getInt('PORT', 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  
  // Vector Store
  vectorStore: (process.env.VECTOR_STORE as 'chroma' | 'faiss' | 'local') || 'local',
  chromaUrl: process.env.CHROMA_URL || 'http://localhost:8000',
  vectorStorePath: process.env.VECTOR_STORE_PATH || path.join(process.cwd(), 'index-store'),
  
  // Document Processing
  chunkSize: getInt('CHUNK_SIZE', 1000),
  chunkOverlap: getInt('CHUNK_OVERLAP', 200),
  maxRetrievalResults: getInt('MAX_RETRIEVAL_RESULTS', 5),
  
  // Embeddings
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  embeddingDimensions: getInt('EMBEDDING_DIMENSIONS', 1536),
  
  // LLM
  llmModel: process.env.LLM_MODEL || 'gpt-4-turbo-preview',
  llmTemperature: getFloat('LLM_TEMPERATURE', 0.1),
  maxTokens: getInt('MAX_TOKENS', 2000),
  
  // OCR
  ocrLanguages: process.env.OCR_LANGUAGES || 'eng+tur',
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || './logs/ai-service.log',
  
  // Data Paths
  documentsPath: process.env.DOCUMENTS_PATH || path.join(process.cwd(), 'data', 'documents'),
  registryPath: process.env.REGISTRY_PATH || path.join(process.cwd(), 'data', 'documents-registry.json'),
};

// Validate configuration on load
try {
  validateConfig();
  logger.info('Configuration loaded successfully', {
    port: config.port,
    nodeEnv: config.nodeEnv,
    vectorStore: config.vectorStore,
    embeddingModel: config.embeddingModel,
    llmModel: config.llmModel,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });
} catch (error) {
  logger.error('Configuration validation failed', { error });
  throw error;
}

export default config;
