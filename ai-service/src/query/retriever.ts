/**
 * Retriever - Retrieves relevant document chunks for queries
 */
import { SearchResult } from '../types';
import { logger } from '../services/logger';
import { embedder } from '../ingest/embedder';
import { vectorStore } from '../vector';
import { config } from '../config';

/**
 * Retriever class - handles semantic search over document chunks
 */
export class Retriever {
  private maxResults: number;

  constructor() {
    this.maxResults = config.maxRetrievalResults;
  }

  /**
   * Retrieve relevant document chunks for a query
   * @param query - The user's query text
   * @param topK - Number of results to retrieve (optional)
   * @returns Array of search results
   */
  async retrieve(query: string, topK?: number): Promise<SearchResult[]> {
    const k = topK || this.maxResults;
    const startTime = Date.now();

    try {
      logger.info('Starting retrieval', { query, topK: k });

      // Step 1: Generate embedding for the query
      logger.debug('Generating query embedding...');
      const queryEmbedding = await embedder.embedText(query);

      // Step 2: Search vector store
      logger.debug('Searching vector store...');
      const results = await vectorStore.search(queryEmbedding, k);

      const duration = Date.now() - startTime;
      
      logger.info('Retrieval completed', {
        resultsFound: results.length,
        duration: `${duration}ms`,
        avgScore: results.length > 0 
          ? (results.reduce((sum, r) => sum + r.score, 0) / results.length).toFixed(3)
          : 0
      });

      return results;

    } catch (error) {
      logger.error('Retrieval failed', { error, query });
      throw error;
    }
  }

  /**
   * Retrieve and format context for LLM
   * @param query - The user's query
   * @param maxLength - Maximum context length in characters
   * @returns Formatted context string and sources
   */
  async retrieveContext(query: string, maxLength?: number): Promise<{
    context: string;
    sources: SearchResult[];
  }> {
    const results = await this.retrieve(query);

    if (results.length === 0) {
      logger.warn('No relevant documents found for query');
      return {
        context: '',
        sources: []
      };
    }

    // Build context from results
    const contextParts: string[] = [];
    const usedSources: SearchResult[] = [];
    let currentLength = 0;
    const limit = maxLength || 8000;

    for (const result of results) {
      const chunkText = result.chunk.content;
      const source = `[Source: ${result.chunk.metadata.filename}${
        result.chunk.pageNumber ? `, Page ${result.chunk.pageNumber}` : ''
      }]`;
      
      const part = `${source}\n${chunkText}\n`;
      
      // Check if adding this chunk would exceed limit
      if (currentLength + part.length > limit) {
        logger.debug('Context length limit reached', {
          currentLength,
          limit,
          chunksUsed: usedSources.length
        });
        break;
      }

      contextParts.push(part);
      usedSources.push(result);
      currentLength += part.length;
    }

    const context = contextParts.join('\n---\n\n');

    logger.debug('Context built', {
      contextLength: context.length,
      sourcesUsed: usedSources.length
    });

    return {
      context,
      sources: usedSources
    };
  }

  /**
   * Filter results by minimum relevance score
   * @param results - Search results
   * @param minScore - Minimum relevance score (0-1)
   * @returns Filtered results
   */
  filterByRelevance(results: SearchResult[], minScore: number = 0.7): SearchResult[] {
    const filtered = results.filter(r => r.score >= minScore);
    
    logger.debug('Filtered results by relevance', {
      original: results.length,
      filtered: filtered.length,
      minScore
    });

    return filtered;
  }

  /**
   * Re-rank results based on query relevance
   * This is a simple implementation - could be enhanced with a reranking model
   * @param results - Search results
   * @param query - Original query
   * @returns Re-ranked results
   */
  rerank(results: SearchResult[], query: string): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/);
    
    // Calculate term overlap score
    const scored = results.map(result => {
      const content = result.chunk.content.toLowerCase();
      const termMatches = queryTerms.filter(term => 
        content.includes(term)
      ).length;
      
      const termScore = termMatches / queryTerms.length;
      
      // Combine with similarity score (weighted average)
      const combinedScore = (result.score * 0.7) + (termScore * 0.3);
      
      return {
        ...result,
        score: combinedScore
      };
    });

    // Sort by combined score
    scored.sort((a, b) => b.score - a.score);

    logger.debug('Results re-ranked', {
      original: results.length,
      reranked: scored.length
    });

    return scored;
  }

  /**
   * Get statistics about retrieval performance
   */
  async getStats(): Promise<{
    avgRetrievalTime: number;
    totalQueries: number;
  }> {
    // Placeholder for future stats tracking
    return {
      avgRetrievalTime: 0,
      totalQueries: 0
    };
  }
}

// Singleton instance
export const retriever = new Retriever();
export default retriever;
