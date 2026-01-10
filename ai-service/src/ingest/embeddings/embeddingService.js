import OpenAI from 'openai';
import logger from '../../utils/logger.js';
import config from '../../config/env.js';

// Initialize OpenAI client
let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient && config.openai.apiKey) {
    openaiClient = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }
  return openaiClient;
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text) {
  try {
    const client = getOpenAIClient();
    
    if (!client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY.');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('Cannot generate embedding for empty text');
    }

    const response = await client.embeddings.create({
      model: config.openai.embeddingModel,
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    logger.error('Error generating embedding', {
      error: error.message,
      textLength: text?.length || 0,
    });
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * More efficient than calling generateEmbedding multiple times
 */
export async function batchGenerateEmbeddings(texts, options = {}) {
  const { batchSize = 100, delayMs = 100 } = options;

  try {
    const client = getOpenAIClient();
    
    if (!client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY.');
    }

    // Filter out empty texts
    const validTexts = texts.filter(t => t && t.trim().length > 0);

    if (validTexts.length === 0) {
      logger.warn('No valid texts to embed');
      return [];
    }

    logger.info('Generating embeddings in batches', {
      totalTexts: validTexts.length,
      batchSize,
    });

    const allEmbeddings = [];

    // Process in batches
    for (let i = 0; i < validTexts.length; i += batchSize) {
      const batch = validTexts.slice(i, i + batchSize);

      logger.debug('Processing batch', {
        batchNumber: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
      });

      const response = await client.embeddings.create({
        model: config.openai.embeddingModel,
        input: batch,
      });

      const embeddings = response.data.map(d => d.embedding);
      allEmbeddings.push(...embeddings);

      // Rate limiting: wait between batches
      if (i + batchSize < validTexts.length && delayMs > 0) {
        await sleep(delayMs);
      }
    }

    logger.info('Batch embedding complete', {
      totalEmbeddings: allEmbeddings.length,
    });

    return allEmbeddings;
  } catch (error) {
    logger.error('Error in batch embedding', {
      error: error.message,
      totalTexts: texts.length,
    });
    throw error;
  }
}

/**
 * Get embedding dimensions for the configured model
 */
export function getEmbeddingDimensions() {
  const model = config.openai.embeddingModel;

  // OpenAI embedding dimensions
  const dimensions = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
  };

  return dimensions[model] || 1536;
}

/**
 * Helper function to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  generateEmbedding,
  batchGenerateEmbeddings,
  getEmbeddingDimensions,
};
