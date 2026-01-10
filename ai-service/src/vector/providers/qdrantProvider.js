import { QdrantClient } from '@qdrant/js-client-rest';
import logger from '../../utils/logger.js';
import config from '../../config/env.js';
import { getEmbeddingDimensions } from '../../ingest/embeddings/embeddingService.js';

let qdrantClient = null;

/**
 * Get or create Qdrant client
 */
function getQdrantClient() {
  if (!qdrantClient) {
    qdrantClient = new QdrantClient({
      url: config.vectorDb.qdrant.url,
      apiKey: config.vectorDb.qdrant.apiKey || undefined,
    });
  }
  return qdrantClient;
}

/**
 * Initialize Qdrant collection
 * Creates collection if it doesn't exist
 */
export async function initializeCollection() {
  try {
    const client = getQdrantClient();
    const collectionName = config.vectorDb.qdrant.collectionName;
    const vectorSize = getEmbeddingDimensions();

    logger.info('Initializing Qdrant collection', { collectionName, vectorSize });

    // Check if collection exists
    const collections = await client.getCollections();
    const collectionExists = collections.collections.some(
      c => c.name === collectionName
    );

    if (collectionExists) {
      logger.info('Collection already exists', { collectionName });
      return { success: true, created: false };
    }

    // Create collection
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
      optimizers_config: {
        default_segment_number: 2,
      },
      replication_factor: 1,
    });

    logger.info('Collection created successfully', { collectionName });
    return { success: true, created: true };
  } catch (error) {
    logger.error('Error initializing Qdrant collection', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Upsert vectors to Qdrant
 */
export async function upsert(vectors) {
  try {
    const client = getQdrantClient();
    const collectionName = config.vectorDb.qdrant.collectionName;

    if (!vectors || vectors.length === 0) {
      logger.warn('No vectors to upsert');
      return { success: true, count: 0 };
    }

    logger.info('Upserting vectors to Qdrant', {
      collectionName,
      count: vectors.length,
    });

    // Format vectors for Qdrant
    const points = vectors.map(v => ({
      id: v.id,
      vector: v.values,
      payload: v.metadata,
    }));

    // Batch upsert (max 100 at a time)
    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);

      await client.upsert(collectionName, {
        wait: true,
        points: batch,
      });

      logger.debug('Batch upserted', {
        batchNumber: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
      });
    }

    logger.info('Vectors upserted successfully', { count: vectors.length });
    return { success: true, count: vectors.length };
  } catch (error) {
    logger.error('Error upserting vectors to Qdrant', {
      error: error.message,
      vectorCount: vectors?.length || 0,
    });
    throw error;
  }
}

/**
 * Search for similar vectors
 */
export async function search(queryVector, options = {}) {
  try {
    const client = getQdrantClient();
    const collectionName = config.vectorDb.qdrant.collectionName;
    const { limit = 5, filter = null, scoreThreshold = 0.7 } = options;

    logger.debug('Searching Qdrant', {
      collectionName,
      limit,
      scoreThreshold,
    });

    const searchParams = {
      vector: queryVector,
      limit,
      with_payload: true,
      with_vector: false,
      score_threshold: scoreThreshold,
    };

    if (filter) {
      searchParams.filter = filter;
    }

    const results = await client.search(collectionName, searchParams);

    logger.debug('Search complete', {
      resultsCount: results.length,
    });

    // Format results
    return results.map(result => ({
      id: result.id,
      score: result.score,
      metadata: result.payload,
    }));
  } catch (error) {
    logger.error('Error searching Qdrant', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Delete vectors by filter
 */
export async function deleteByFilter(filter) {
  try {
    const client = getQdrantClient();
    const collectionName = config.vectorDb.qdrant.collectionName;

    logger.info('Deleting vectors from Qdrant', { collectionName, filter });

    await client.delete(collectionName, {
      wait: true,
      filter,
    });

    logger.info('Vectors deleted successfully');
    return { success: true };
  } catch (error) {
    logger.error('Error deleting vectors from Qdrant', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get collection info
 */
export async function getCollectionInfo() {
  try {
    const client = getQdrantClient();
    const collectionName = config.vectorDb.qdrant.collectionName;

    const info = await client.getCollection(collectionName);

    return {
      name: collectionName,
      vectorsCount: info.vectors_count,
      pointsCount: info.points_count,
      status: info.status,
    };
  } catch (error) {
    logger.error('Error getting collection info', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Health check for Qdrant
 */
export async function healthCheck() {
  try {
    const client = getQdrantClient();
    const collections = await client.getCollections();
    return {
      status: 'healthy',
      collections: collections.collections.length,
    };
  } catch (error) {
    logger.error('Qdrant health check failed', {
      error: error.message,
    });
    return {
      status: 'unhealthy',
      error: error.message,
    };
  }
}

export default {
  initializeCollection,
  upsert,
  search,
  deleteByFilter,
  getCollectionInfo,
  healthCheck,
};
