import dotenv from 'dotenv';
import path from 'path';
import { AppConfig, Language } from '../types';

// Load environment variables from .env file
dotenv.config();

/**
 * Supported languages for the application
 */
export const SUPPORTED_LANGUAGES: Language[] = ['tr', 'en'];

/**
 * Application configuration object
 * Loaded from environment variables with sensible defaults
 */
export const config: AppConfig & {
  nodeEnv: string;
  llm: {
    model: string;
    embeddingModel: string;
    temperature: number;
    maxTokens: number;
  };
  vectorStore: {
    type: 'chroma' | 'faiss';
    host: string;
    port: number;
    collection: string;
    dimension: number;
  };
  logging: {
    level: string;
  };
  cors: {
    origin: string;
  };
  supportedLanguages: Language[];
} = {
  // Server Configuration
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // OpenAI API Key (required)
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // File Paths (resolved to absolute paths)
  documentsPath: path.resolve(
    process.env.DOCUMENTS_PATH || path.join(__dirname, '../../documents')
  ),
  indexStorePath: path.resolve(
    process.env.INDEX_STORE_PATH || path.join(__dirname, '../../index-store')
  ),

  // LLM Settings
  llm: {
    /** Model to use for chat completions */
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
    /** Model to use for generating embeddings */
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    /** Temperature for response generation (0-2, lower = more deterministic) */
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
    /** Maximum tokens in generated response */
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000', 10),
  },

  // Chunking Settings
  maxChunkSize: parseInt(process.env.CHUNK_SIZE || '1000', 10),
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200', 10),

  // Vector Store Configuration
  vectorStore: {
    type: (process.env.VECTOR_STORE_TYPE || 'chroma') as 'chroma' | 'faiss',
    host: process.env.CHROMA_HOST || 'localhost',
    port: parseInt(process.env.CHROMA_PORT || '8000', 10),
    collection: process.env.CHROMA_COLLECTION || 'cew_documents',
    /** Embedding dimension for text-embedding-3-small */
    dimension: 1536,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },

  // Supported Languages
  supportedLanguages: SUPPORTED_LANGUAGES,
};

/**
 * Validates the configuration and throws an error if required fields are missing
 * @throws Error if validation fails
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // Required fields
  if (!config.openaiApiKey) {
    errors.push('OPENAI_API_KEY is required - set it in your .env file');
  }

  // Validate port
  if (config.port < 1 || config.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  // Validate chunking settings
  if (config.maxChunkSize < 100) {
    errors.push('CHUNK_SIZE must be at least 100 characters');
  }

  if (config.chunkOverlap < 0) {
    errors.push('CHUNK_OVERLAP cannot be negative');
  }

  if (config.chunkOverlap >= config.maxChunkSize) {
    errors.push('CHUNK_OVERLAP must be less than CHUNK_SIZE');
  }

  // Validate LLM settings
  if (config.llm.temperature < 0 || config.llm.temperature > 2) {
    errors.push('LLM_TEMPERATURE must be between 0 and 2');
  }

  if (config.llm.maxTokens < 1) {
    errors.push('LLM_MAX_TOKENS must be at least 1');
  }

  // Throw if there are validation errors
  if (errors.length > 0) {
    throw new Error(
      `Configuration validation failed:\n  - ${errors.join('\n  - ')}`
    );
  }
}

/**
 * Masks sensitive values for safe logging
 */
function maskSensitive(value: string): string {
  if (!value || value.length < 8) return '***';
  return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
}

/**
 * Logs a summary of the current configuration (without sensitive values)
 */
export function logConfigSummary(): void {
  const summary = {
    environment: config.nodeEnv,
    port: config.port,
    openaiApiKey: maskSensitive(config.openaiApiKey),
    llm: {
      model: config.llm.model,
      embeddingModel: config.llm.embeddingModel,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
    },
    chunking: {
      maxChunkSize: config.maxChunkSize,
      chunkOverlap: config.chunkOverlap,
    },
    paths: {
      documents: config.documentsPath,
      indexStore: config.indexStorePath,
    },
    vectorStore: {
      type: config.vectorStore.type,
      host: config.vectorStore.host,
      port: config.vectorStore.port,
      collection: config.vectorStore.collection,
    },
    supportedLanguages: config.supportedLanguages,
    cors: config.cors.origin,
    logLevel: config.logging.level,
  };

  console.log('\n📋 Configuration Summary:');
  console.log('─'.repeat(50));
  console.log(JSON.stringify(summary, null, 2));
  console.log('─'.repeat(50) + '\n');
}

/**
 * Initialize configuration - validate and log summary
 * Call this on application startup
 */
export function initializeConfig(): void {
  validateConfig();
  logConfigSummary();
}

export default config;
