import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env') });

export const config = {
  // Server configuration
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // OpenAI configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    llmModel: process.env.OPENAI_LLM_MODEL || 'gpt-4-turbo-preview',
  },

  // Vector database configuration
  vectorDb: {
    provider: process.env.VECTOR_DB_PROVIDER || 'qdrant',
    qdrant: {
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      apiKey: process.env.QDRANT_API_KEY || '',
      collectionName: process.env.QDRANT_COLLECTION_NAME || 'cew_documents',
    },
    pinecone: {
      apiKey: process.env.PINECONE_API_KEY || '',
      environment: process.env.PINECONE_ENVIRONMENT || '',
      indexName: process.env.PINECONE_INDEX_NAME || 'cew-documents',
    },
  },

  // Chunking configuration
  chunking: {
    chunkSize: parseInt(process.env.CHUNK_SIZE || '500', 10),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '50', 10),
    minChunkSize: parseInt(process.env.MIN_CHUNK_SIZE || '100', 10),
  },

  // Rate limiting configuration
  rateLimiting: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  // CORS configuration
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },

  // Document storage configuration
  documentsPath: process.env.DOCUMENTS_PATH || './documents',
};

// Validate required configuration
export function validateConfig() {
  const errors = [];

  if (!config.openai.apiKey && config.nodeEnv !== 'test') {
    errors.push('OPENAI_API_KEY is required');
  }

  if (config.vectorDb.provider === 'pinecone') {
    if (!config.vectorDb.pinecone.apiKey) {
      errors.push('PINECONE_API_KEY is required when using Pinecone');
    }
    if (!config.vectorDb.pinecone.environment) {
      errors.push('PINECONE_ENVIRONMENT is required when using Pinecone');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export default config;
