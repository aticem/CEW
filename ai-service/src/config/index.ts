/**
 * Configuration module for CEW AI Service
 * @module config
 * 
 * Loads environment variables, validates required configuration,
 * and exports a typed configuration object.
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

// ============================================================================
// Configuration Interface
// ============================================================================

export interface Config {
  /** Server configuration */
  server: {
    port: number;
    env: 'development' | 'staging' | 'production';
  };

  /** File paths */
  paths: {
    documents: string;
    indexStore: string;
    cewFrontend: string;
    cewQAQC: string;
  };

  /** LLM configuration */
  llm: {
    apiKey: string;
    model: string;
    embeddingModel: string;
    temperature: number;
    maxTokens: number;
  };

  /** Document chunking configuration */
  chunking: {
    chunkSize: number;
    chunkOverlap: number;
  };

  /** Supported languages for document processing */
  supportedLanguages: string[];

  /** Vector store configuration */
  vectorStore: {
    provider: 'chromadb' | 'faiss';
    collectionName: string;
    chromaHost: string;
    chromaPort: number;
  };

  /** Logging configuration */
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    filePath: string;
  };

  /** OCR configuration */
  ocr: {
    enabled: boolean;
    language: string;
  };
}

// ============================================================================
// Environment Variable Helpers
// ============================================================================

/**
 * Get required environment variable or throw error
 */
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Please set it in your .env file or environment.`
    );
  }
  return value;
}

/**
 * Get optional environment variable with default value
 */
function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Parse integer from environment variable
 */
function getIntEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`Invalid integer for ${key}: "${value}", using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse float from environment variable
 */
function getFloatEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    console.warn(`Invalid float for ${key}: "${value}", using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse boolean from environment variable
 */
function getBoolEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

// ============================================================================
// Configuration Validation
// ============================================================================

/**
 * Validate and build the configuration object
 * @throws Error if required configuration is missing
 */
function buildConfig(): Config {
  // Validate required environment variables
  const openaiApiKey = getRequiredEnv('OPENAI_API_KEY');

  const nodeEnv = getOptionalEnv('NODE_ENV', 'development') as Config['server']['env'];
  
  // Validate NODE_ENV value
  if (!['development', 'staging', 'production'].includes(nodeEnv)) {
    console.warn(`Invalid NODE_ENV: "${nodeEnv}", defaulting to "development"`);
  }

  const config: Config = {
    server: {
      port: getIntEnv('PORT', 3001),
      env: ['development', 'staging', 'production'].includes(nodeEnv) 
        ? nodeEnv 
        : 'development',
    },

    paths: {
      documents: path.resolve(getOptionalEnv('DOCUMENTS_PATH', './documents')),
      indexStore: path.resolve(getOptionalEnv('INDEX_STORE_PATH', './index-store')),
      cewFrontend: path.resolve(getOptionalEnv('CEW_FRONTEND_PATH', '../CEW1/_root')),
      cewQAQC: path.resolve(getOptionalEnv('CEW_QAQC_PATH', '../CEW1/_root/public/QAQC')),
    },

    llm: {
      apiKey: openaiApiKey,
      model: getOptionalEnv('LLM_MODEL', 'gpt-4-turbo-preview'),
      embeddingModel: getOptionalEnv('EMBEDDING_MODEL', 'text-embedding-3-small'),
      temperature: getFloatEnv('LLM_TEMPERATURE', 0.7),
      maxTokens: getIntEnv('LLM_MAX_TOKENS', 2000),
    },

    chunking: {
      chunkSize: getIntEnv('CHUNK_SIZE', 1000),
      chunkOverlap: getIntEnv('CHUNK_OVERLAP', 200),
    },

    supportedLanguages: getOptionalEnv('SUPPORTED_LANGUAGES', 'tr,en')
      .split(',')
      .map(lang => lang.trim().toLowerCase()),

    vectorStore: {
      provider: getOptionalEnv('VECTOR_STORE_PROVIDER', 'chromadb') as 'chromadb' | 'faiss',
      collectionName: getOptionalEnv('VECTOR_STORE_COLLECTION', 'cew_documents'),
      chromaHost: getOptionalEnv('CHROMA_HOST', 'localhost'),
      chromaPort: getIntEnv('CHROMA_PORT', 8000),
    },

    logging: {
      level: getOptionalEnv('LOG_LEVEL', 'info') as Config['logging']['level'],
      filePath: getOptionalEnv('LOG_FILE', './logs/app.log'),
    },

    ocr: {
      enabled: getBoolEnv('OCR_ENABLED', true),
      language: getOptionalEnv('TESSERACT_LANG', 'eng'),
    },
  };

  return config;
}

// ============================================================================
// Safe Config Summary (No Secrets)
// ============================================================================

/**
 * Get a safe configuration summary for logging (excludes secrets)
 */
export function getSafeConfigSummary(cfg: Config): Record<string, unknown> {
  return {
    server: cfg.server,
    paths: {
      documents: cfg.paths.documents,
      indexStore: cfg.paths.indexStore,
      cewFrontend: cfg.paths.cewFrontend,
      cewQAQC: cfg.paths.cewQAQC,
    },
    llm: {
      apiKey: cfg.llm.apiKey ? '***SET***' : '***MISSING***',
      model: cfg.llm.model,
      embeddingModel: cfg.llm.embeddingModel,
      temperature: cfg.llm.temperature,
      maxTokens: cfg.llm.maxTokens,
    },
    chunking: cfg.chunking,
    supportedLanguages: cfg.supportedLanguages,
    vectorStore: cfg.vectorStore,
    logging: cfg.logging,
    ocr: cfg.ocr,
  };
}

/**
 * Log configuration summary to console
 */
export function logConfigSummary(cfg: Config): void {
  const summary = getSafeConfigSummary(cfg);
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           CEW AI Service - Configuration Summary             ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║ Environment:    ${cfg.server.env.padEnd(45)}║`);
  console.log(`║ Port:           ${String(cfg.server.port).padEnd(45)}║`);
  console.log(`║ LLM Model:      ${cfg.llm.model.padEnd(45)}║`);
  console.log(`║ Embedding:      ${cfg.llm.embeddingModel.padEnd(45)}║`);
  console.log(`║ Chunk Size:     ${String(cfg.chunking.chunkSize).padEnd(45)}║`);
  console.log(`║ Chunk Overlap:  ${String(cfg.chunking.chunkOverlap).padEnd(45)}║`);
  console.log(`║ Languages:      ${cfg.supportedLanguages.join(', ').padEnd(45)}║`);
  console.log(`║ Vector Store:   ${cfg.vectorStore.provider.padEnd(45)}║`);
  console.log(`║ Log Level:      ${cfg.logging.level.padEnd(45)}║`);
  console.log(`║ OCR Enabled:    ${String(cfg.ocr.enabled).padEnd(45)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║ API Key:        ${(cfg.llm.apiKey ? '✓ Set' : '✗ Missing').padEnd(45)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  // Also log full summary as JSON for structured logging
  if (cfg.server.env === 'development') {
    console.log('Full config (development only):', JSON.stringify(summary, null, 2));
  }
}

// ============================================================================
// Build and Export Configuration
// ============================================================================

/** Application configuration singleton */
export const config: Config = buildConfig();

// Log configuration on module load (only in non-test environments)
if (process.env.NODE_ENV !== 'test') {
  logConfigSummary(config);
}

export default config;
