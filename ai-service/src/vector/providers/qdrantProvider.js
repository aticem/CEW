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
 * Upsert payloads without embeddings (ingest-time only)
 * Uses zero vectors as placeholders - embeddings generated at query time
 */
export async function upsertPayloads(payloads) {
  try {
    const client = getQdrantClient();
    const collectionName = config.vectorDb.qdrant.collectionName;

    if (!payloads || payloads.length === 0) {
      logger.warn('No payloads to upsert');
      return { success: true, count: 0 };
    }

    logger.info('Upserting payloads to Qdrant (no embeddings - local ingest)', {
      collectionName,
      count: payloads.length,
    });

    // Create zero vector as placeholder (Qdrant requires vectors)
    const vectorSize = getEmbeddingDimensions();
    const zeroVector = new Array(vectorSize).fill(0);

    // Format payloads for Qdrant with zero vectors
    const points = payloads.map(p => {
      // Sanitize payload - remove null/undefined values that might cause issues
      const sanitizedPayload = {};
      for (const [key, value] of Object.entries(p.payload)) {
        if (value !== null && value !== undefined) {
          sanitizedPayload[key] = value;
        }
      }
      
      return {
        id: p.id,
        vector: zeroVector, // Placeholder - real embeddings at query time
        payload: { ...sanitizedPayload, _has_embedding: false }, // Mark as no embedding yet
      };
    });

    // Log first point for debugging
    if (points.length > 0) {
      logger.debug('Sample point structure', {
        id: points[0].id,
        vectorLength: points[0].vector.length,
        payloadKeys: Object.keys(points[0].payload),
      });
    }

    // Batch upsert (max 100 at a time)
    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);

      try {
        await client.upsert(collectionName, {
          wait: true,
          points: batch,
        });
      } catch (batchError) {
        logger.error('Batch upsert failed', {
          batchNumber: Math.floor(i / batchSize) + 1,
          error: batchError.message,
          sampleId: batch[0]?.id,
        });
        throw batchError;
      }

      logger.debug('Batch payload upserted', {
        batchNumber: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
      });
    }

    logger.info('Payloads upserted successfully (embeddings deferred)', {
      count: payloads.length,
    });
    return { success: true, count: payloads.length };
  } catch (error) {
    logger.error('Error upserting payloads to Qdrant', {
      error: error.message,
      errorDetails: error.response?.data || error.stack,
      payloadCount: payloads?.length || 0,
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
 * Search with on-demand embeddings (for zero-vector ingestion)
 * Retrieves all chunks, generates embeddings, computes similarity locally
 */
export async function searchWithOnDemandEmbeddings(queryVector, options = {}) {
  try {
    const client = getQdrantClient();
    const collectionName = config.vectorDb.qdrant.collectionName;
    const { limit = 5, scoreThreshold = 0.7 } = options;

    logger.debug('Searching with on-demand embeddings', {
      collectionName,
      limit,
    });

    // Scroll all points (retrieve all chunks)
    const scrollResult = await client.scroll(collectionName, {
      limit: 100,
      with_payload: true,
      with_vector: false,
    });

    const allChunks = scrollResult.points || [];

    if (allChunks.length === 0) {
      logger.warn('No chunks found in database');
      return [];
    }

    logger.debug(`Retrieved ${allChunks.length} chunks for similarity computation`);

    // Import embedding service dynamically to avoid circular dependency
    const { batchGenerateEmbeddings } = await import('../../ingest/embeddings/embeddingService.js');

    // Generate embeddings for all chunk texts
    const chunkTexts = allChunks.map(chunk => chunk.payload.chunk_text);
    const chunkEmbeddings = await batchGenerateEmbeddings(chunkTexts);

    // Compute cosine similarity for each chunk
    const similarities = chunkEmbeddings.map((chunkEmbed, index) => {
      const similarity = cosineSimilarity(queryVector, chunkEmbed);
      return {
        index,
        similarity,
        chunk: allChunks[index],
      };
    });

    // Filter by threshold and sort by similarity (descending)
    const filtered = similarities
      .filter(item => item.similarity >= scoreThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    logger.debug(`Filtered to ${filtered.length} results above threshold ${scoreThreshold}`);

    // Format results
    return filtered.map(item => ({
      id: item.chunk.id,
      score: item.similarity,
      metadata: item.chunk.payload,
    }));
  } catch (error) {
    logger.error('Error in on-demand embedding search', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Keyword-based search using BM25 (NO API calls)
 * Pure lexical search - retrieves all chunks and scores with BM25
 */
export async function searchKeywordBM25(query, options = {}) {
  try {
    const client = getQdrantClient();
    const collectionName = config.vectorDb.qdrant.collectionName;
    const { limit = 10, minScore = 0 } = options;

    logger.info('Keyword-based BM25 search (API-free)', {
      query,
      collectionName,
      limit,
    });

    // Retrieve all chunks from database
    const scrollResult = await client.scroll(collectionName, {
      limit: 100,
      with_payload: true,
      with_vector: false,
    });

    const allChunks = scrollResult.points || [];

    if (allChunks.length === 0) {
      logger.warn('No chunks found in database for BM25 search');
      return [];
    }

    logger.info(`Retrieved ${allChunks.length} chunks for BM25 scoring`);

    // Import BM25 scorer
    const { scoreBM25 } = await import('../../query/retrieval/bm25Scorer.js');

    // Convert Qdrant points to chunk payloads
    const chunkPayloads = allChunks.map(point => point.payload);

    // Score with BM25
    const scoredResults = scoreBM25(query, chunkPayloads, {
      limit,
      minScore,
      sectionTitleBoost: 2.0, // Boost if query terms in section title
    });

    // Log retrieved sections for debugging
    if (scoredResults.length > 0) {
      const sections = scoredResults.map(r => r.chunk.section_title || r.chunk.section || 'N/A');
      logger.info('BM25 retrieved sections', {
        count: scoredResults.length,
        sections: sections.slice(0, 10),
      });
    }

    // Format results to match expected structure
    return scoredResults.map((result, index) => ({
      id: allChunks.find(c => c.payload.chunk_text === result.chunk.chunk_text)?.id || `bm25-${index}`,
      score: result.score,
      metadata: result.chunk,
    }));
  } catch (error) {
    logger.error('Error in keyword BM25 search', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(vec1, vec2) {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    mag1 += vec1[i] * vec1[i];
    mag2 += vec2[i] * vec2[i];
  }

  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);

  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }

  return dotProduct / (mag1 * mag2);
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
  upsertPayloads,
  search,
  searchWithOnDemandEmbeddings,
  deleteByFilter,
  getCollectionInfo,
  healthCheck,
};
