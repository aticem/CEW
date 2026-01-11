import config from '../config/env.js';
import logger from '../utils/logger.js';
import * as qdrantProvider from './providers/qdrantProvider.js';

/**
 * Unified Vector Database Client
 * Provides abstraction over different vector database providers
 */

let vectorDbProvider = null;

/**
 * Get the configured vector database provider
 */
function getProvider() {
  if (!vectorDbProvider) {
    const providerName = config.vectorDb.provider;

    logger.info('Initializing vector database provider', { provider: providerName });

    switch (providerName) {
      case 'qdrant':
        vectorDbProvider = qdrantProvider;
        break;
      // Future providers can be added here
      // case 'pinecone':
      //   vectorDbProvider = pineconeProvider;
      //   break;
      default:
        throw new Error(`Unsupported vector database provider: ${providerName}`);
    }
  }

  return vectorDbProvider;
}

/**
 * Initialize the vector database (create collections, indexes, etc.)
 */
export async function initialize() {
  const provider = getProvider();
  return provider.initializeCollection();
}

/**
 * Upsert vectors to the database
 */
export async function upsert(vectors) {
  const provider = getProvider();
  return provider.upsert(vectors);
}

/**
 * Upsert payloads without vectors (for ingest-time storage)
 * Vectors will be generated on-demand during queries
 */
export async function upsertPayloads(payloads) {
  const provider = getProvider();
  return provider.upsertPayloads(payloads);
}

/**
 * Search for similar vectors
 */
export async function search(queryVector, options) {
  const provider = getProvider();
  return provider.search(queryVector, options);
}

/**
 * Search with on-demand embedding generation
 * Since ingest uses zero-vector placeholders, we retrieve all chunks,
 * generate embeddings on-demand, and compute similarity locally
 */
export async function searchWithOnDemandEmbeddings(queryVector, options) {
  const provider = getProvider();
  return provider.searchWithOnDemandEmbeddings(queryVector, options);
}

/**
 * Keyword-based search using BM25 (NO API calls)
 * Pure lexical search - API-free retrieval
 */
export async function searchKeywordBM25(query, options) {
  const provider = getProvider();
  return provider.searchKeywordBM25(query, options);
}

/**
 * Delete vectors by filter
 */
export async function deleteByFilter(filter) {
  const provider = getProvider();
  return provider.deleteByFilter(filter);
}

/**
 * Get collection/index information
 */
export async function getCollectionInfo() {
  const provider = getProvider();
  return provider.getCollectionInfo();
}

/**
 * Health check for vector database
 */
export async function healthCheck() {
  const provider = getProvider();
  return provider.healthCheck();
}

export default {
  initialize,
  upsert,
  search,
  deleteByFilter,
  getCollectionInfo,
  healthCheck,
};
