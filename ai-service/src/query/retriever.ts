import { indexer } from '../ingest/indexer';
import { embedder } from '../ingest/embedder';
import { QueryFilters, VectorSearchResult, SourceReference } from '../types';
import { logger } from '../services/logger';

export interface RetrievalOptions {
  maxResults?: number;
  minScore?: number;
  filters?: QueryFilters;
  rerank?: boolean;
}

export interface RetrievalResult {
  chunks: VectorSearchResult[];
  sources: SourceReference[];
  context: string;
}

class Retriever {
  private defaultOptions: Required<Omit<RetrievalOptions, 'filters'>> = {
    maxResults: 5,
    minScore: 0.7,
    rerank: true,
  };

  async retrieve(
    query: string,
    options?: RetrievalOptions
  ): Promise<RetrievalResult> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();

    // Build filter for vector store
    const filter = this.buildFilter(options?.filters);

    // Search vector store
    let results = await indexer.search(query, opts.maxResults * 2, filter);

    // Filter by minimum score
    results = results.filter((r) => r.score >= opts.minScore);

    // Rerank if enabled
    if (opts.rerank && results.length > 0) {
      results = await this.rerankResults(query, results);
    }

    // Take top results
    results = results.slice(0, opts.maxResults);

    // Build context string
    const context = this.buildContext(results);

    // Build source references
    const sources = this.buildSourceReferences(results);

    const processingTime = Date.now() - startTime;
    logger.info('Retrieval completed', {
      query: query.slice(0, 50),
      resultsCount: results.length,
      processingTimeMs: processingTime,
    });

    return {
      chunks: results,
      sources,
      context,
    };
  }

  private buildFilter(
    filters?: QueryFilters
  ): Record<string, unknown> | undefined {
    if (!filters) return undefined;

    const whereConditions: Record<string, unknown>[] = [];

    if (filters.documentIds && filters.documentIds.length > 0) {
      whereConditions.push({
        documentId: { $in: filters.documentIds },
      });
    }

    if (filters.documentTypes && filters.documentTypes.length > 0) {
      whereConditions.push({
        documentType: { $in: filters.documentTypes },
      });
    }

    if (filters.tags && filters.tags.length > 0) {
      whereConditions.push({
        tags: { $containsAny: filters.tags },
      });
    }

    if (whereConditions.length === 0) return undefined;
    if (whereConditions.length === 1) return whereConditions[0];

    return { $and: whereConditions };
  }

  private async rerankResults(
    query: string,
    results: VectorSearchResult[]
  ): Promise<VectorSearchResult[]> {
    // Simple reranking based on keyword matching
    // Can be replaced with a proper reranker model (e.g., Cohere rerank)
    const queryTokens = this.tokenize(query.toLowerCase());

    const scored = results.map((result) => {
      const contentTokens = this.tokenize(result.chunk.content.toLowerCase());
      const overlap = queryTokens.filter((t) => contentTokens.includes(t)).length;
      const keywordScore = overlap / queryTokens.length;

      // Combine vector similarity with keyword score
      const combinedScore = result.score * 0.7 + keywordScore * 0.3;

      return {
        ...result,
        score: combinedScore,
      };
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  private tokenize(text: string): string[] {
    return text
      .split(/\W+/)
      .filter((token) => token.length > 2)
      .filter((token) => !this.isStopWord(token));
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
      'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose',
    ]);
    return stopWords.has(word);
  }

  private buildContext(results: VectorSearchResult[]): string {
    if (results.length === 0) {
      return '';
    }

    const contextParts = results.map((result, index) => {
      const { chunk } = result;
      const pageInfo = chunk.metadata.pageNumber
        ? ` (Page ${chunk.metadata.pageNumber})`
        : '';
      const headers = chunk.metadata.headers?.join(' > ') || '';
      const headerInfo = headers ? `\n[${headers}]` : '';

      return `[Source ${index + 1}${pageInfo}]${headerInfo}\n${chunk.content}`;
    });

    return contextParts.join('\n\n---\n\n');
  }

  private buildSourceReferences(results: VectorSearchResult[]): SourceReference[] {
    // Group by document and deduplicate
    const documentMap = new Map<string, SourceReference>();

    results.forEach((result) => {
      const { chunk, score } = result;
      const existingRef = documentMap.get(chunk.documentId);

      if (!existingRef || score > existingRef.relevanceScore) {
        documentMap.set(chunk.documentId, {
          documentId: chunk.documentId,
          documentName: chunk.documentId, // Will be populated from metadata in real implementation
          pageNumber: chunk.metadata.pageNumber,
          excerpt: this.truncateExcerpt(chunk.content),
          relevanceScore: score,
        });
      }
    });

    return Array.from(documentMap.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );
  }

  private truncateExcerpt(content: string, maxLength: number = 200): string {
    if (content.length <= maxLength) {
      return content;
    }

    const truncated = content.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    return (lastSpace > maxLength * 0.8 ? truncated.slice(0, lastSpace) : truncated) + '...';
  }
}

export const retriever = new Retriever();
