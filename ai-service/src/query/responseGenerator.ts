/**
 * Response Generator - Orchestrates the complete query response pipeline
 */
import { ChatRequest, ChatResponse, QueryType, Source } from '../types';
import { logger } from '../services/logger';
import { policyService } from '../services/policyService';
import { queryClassifier } from './queryClassifier';
import { retriever } from './retriever';
import { llmService } from '../services/llmService';

/**
 * Response Generator class - main orchestrator for query handling
 */
export class ResponseGenerator {
  /**
   * Generate a response for a user query
   * @param request - Chat request
   * @returns Chat response
   */
  async generateResponse(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();

    try {
      logger.info('Processing chat request', {
        query: request.query,
        userId: request.userId,
        conversationId: request.conversationId
      });

      // Step 1: Validate query safety
      if (!policyService.isSafeQuery(request.query)) {
        logger.warn('Unsafe query detected', { query: request.query });
        return this.createErrorResponse(
          'Query contains potentially unsafe content.',
          request.language || 'en',
          startTime
        );
      }

      // Step 2: Classify query
      const classifiedQuery = queryClassifier.classifyQuery(request.query);
      const language = request.language || classifiedQuery.language;

      logger.info('Query classified', {
        type: classifiedQuery.type,
        language: classifiedQuery.language,
        confidence: classifiedQuery.confidence
      });

      // Step 3: Route based on query type
      let response: ChatResponse;

      switch (classifiedQuery.type) {
        case QueryType.GENERAL:
          response = await this.handleGeneralQuery(request.query, language, startTime);
          break;

        case QueryType.OUT_OF_SCOPE:
          response = await this.handleOutOfScopeQuery(language, startTime);
          break;

        case QueryType.DATA:
          response = await this.handleDataQuery(request.query, language, startTime);
          break;

        case QueryType.DOCUMENT:
        default:
          response = await this.handleDocumentQuery(request.query, language, startTime);
          break;
      }

      logger.info('Response generated successfully', {
        queryType: response.queryType,
        processingTime: response.processingTime,
        sourcesCount: response.sources.length
      });

      return response;

    } catch (error) {
      logger.error('Response generation failed', { error, query: request.query });
      
      return this.createErrorResponse(
        'An error occurred while processing your query. Please try again.',
        request.language || 'en',
        startTime
      );
    }
  }

  /**
   * Handle document-based queries (RAG)
   */
  private async handleDocumentQuery(
    query: string,
    language: string,
    startTime: number
  ): Promise<ChatResponse> {
    try {
      // Retrieve relevant context
      const { context, sources } = await retriever.retrieveContext(query);

      if (!context || context.length === 0) {
        // No relevant documents found
        const noAnswerMessage = policyService.getNoAnswerTemplate(language);
        
        return {
          answer: noAnswerMessage,
          sources: [],
          queryType: QueryType.DOCUMENT,
          language,
          confidence: 0.5,
          processingTime: Date.now() - startTime,
          warnings: ['No relevant documents found for this query']
        };
      }

      // Generate answer using LLM
      const llmResponse = await llmService.generateAnswer(query, context, language);

      // Convert sources to the expected format
      const formattedSources: Source[] = sources.map(s => ({
        documentId: s.chunk.documentId,
        filename: s.chunk.metadata.filename,
        pageNumber: s.chunk.pageNumber,
        excerpt: s.chunk.content.substring(0, 200) + '...',
        relevanceScore: s.score
      }));

      return {
        answer: llmResponse.answer,
        sources: formattedSources,
        queryType: QueryType.DOCUMENT,
        language,
        confidence: 0.85,
        processingTime: Date.now() - startTime,
        tokenUsage: llmResponse.tokenUsage
      };

    } catch (error) {
      logger.error('Document query handling failed', { error });
      throw error;
    }
  }

  /**
   * Handle general queries (greetings, etc.)
   */
  private async handleGeneralQuery(
    query: string,
    language: string,
    startTime: number
  ): Promise<ChatResponse> {
    const greeting = policyService.getGreetingTemplate(language);

    return {
      answer: greeting,
      sources: [],
      queryType: QueryType.GENERAL,
      language,
      confidence: 0.95,
      processingTime: Date.now() - startTime
    };
  }

  /**
   * Handle out-of-scope queries
   */
  private async handleOutOfScopeQuery(
    language: string,
    startTime: number
  ): Promise<ChatResponse> {
    const message = policyService.getOutOfScopeTemplate(language);

    return {
      answer: message,
      sources: [],
      queryType: QueryType.OUT_OF_SCOPE,
      language,
      confidence: 0.8,
      processingTime: Date.now() - startTime,
      warnings: ['Query is outside the system scope']
    };
  }

  /**
   * Handle data queries (database/statistics)
   */
  private async handleDataQuery(
    query: string,
    language: string,
    startTime: number
  ): Promise<ChatResponse> {
    const message = language === 'tr'
      ? `Bu tür veri sorguları henüz desteklenmiyor. Şu anda yalnızca yüklenmiş teknik dokümanlardaki bilgilere erişebiliyorum.

Belirli bir konu hakkında dokümanlarda ne yazıyor diye sorabilirsiniz.`
      : `This type of data query is not yet supported. Currently, I can only access information from uploaded technical documents.

You can ask me what the documents say about a specific topic.`;

    return {
      answer: message,
      sources: [],
      queryType: QueryType.DATA,
      language,
      confidence: 0.7,
      processingTime: Date.now() - startTime,
      warnings: ['Database queries are not yet implemented']
    };
  }

  /**
   * Create an error response
   */
  private createErrorResponse(
    message: string,
    language: string,
    startTime: number
  ): ChatResponse {
    return {
      answer: message,
      sources: [],
      queryType: QueryType.OUT_OF_SCOPE,
      language,
      confidence: 0,
      processingTime: Date.now() - startTime,
      warnings: ['An error occurred during processing']
    };
  }

  /**
   * Get query statistics (placeholder for future implementation)
   */
  async getStats(): Promise<{
    totalQueries: number;
    avgProcessingTime: number;
    queryTypeDistribution: Record<QueryType, number>;
  }> {
    // Placeholder for stats tracking
    return {
      totalQueries: 0,
      avgProcessingTime: 0,
      queryTypeDistribution: {
        [QueryType.DOCUMENT]: 0,
        [QueryType.DATA]: 0,
        [QueryType.GENERAL]: 0,
        [QueryType.OUT_OF_SCOPE]: 0
      }
    };
  }
}

// Singleton instance
export const responseGenerator = new ResponseGenerator();
export default responseGenerator;
