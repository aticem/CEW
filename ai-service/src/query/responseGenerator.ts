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
   * @returns Chat response - ALWAYS returns a valid ChatResponse, never throws
   */
  async generateResponse(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    const language = request.language || 'en';

    try {
      logger.info('Processing chat request', {
        query: request.query,
        userId: request.userId,
        conversationId: request.conversationId
      });

      // Step 1: Validate query safety
      if (!policyService.isSafeQuery(request.query)) {
        logger.warn('Unsafe query detected', { query: request.query });
        return this.createSafeResponse(
          'Query contains potentially unsafe content.',
          language,
          startTime
        );
      }

      // Step 2: Classify query
      const classifiedQuery = queryClassifier.classifyQuery(request.query);
      const detectedLanguage = request.language || classifiedQuery.language;

      logger.info('Query classified', {
        type: classifiedQuery.type,
        language: classifiedQuery.language,
        confidence: classifiedQuery.confidence
      });

      // Step 3: Route based on query type - each handler is wrapped in try/catch
      let response: ChatResponse;

      try {
        switch (classifiedQuery.type) {
          case QueryType.GENERAL:
            response = await this.handleGeneralQuery(request.query, detectedLanguage, startTime);
            break;

          case QueryType.OUT_OF_SCOPE:
            response = await this.handleOutOfScopeQuery(detectedLanguage, startTime);
            break;

          case QueryType.DATA:
            response = await this.handleDataQuery(request.query, detectedLanguage, startTime);
            break;

          case QueryType.DOCUMENT:
          default:
            response = await this.handleDocumentQuery(request.query, detectedLanguage, startTime);
            break;
        }
      } catch (handlerError) {
        logger.error('Query handler failed', { 
          error: handlerError,
          queryType: classifiedQuery.type,
          query: request.query
        });
        return this.createSafeResponse(
          'Sorry, I couldn\'t process your question. Please try again.',
          detectedLanguage,
          startTime
        );
      }

      logger.info('Response generated successfully', {
        queryType: response.queryType,
        processingTime: response.processingTime,
        sourcesCount: response.sources.length
      });

      return response;

    } catch (error) {
      // Catch-all: This should NEVER happen, but if it does, return safe response
      logger.error('Response generation critical failure', { 
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack
        } : error,
        query: request.query 
      });
      
      return this.createSafeResponse(
        'Sorry, I couldn\'t process your question. Please try again.',
        language,
        startTime
      );
    }
  }

  /**
   * Handle document-based queries (RAG)
   * CRITICAL: ALWAYS returns a valid ChatResponse, NEVER throws
   */
  private async handleDocumentQuery(
    query: string,
    language: string,
    startTime: number
  ): Promise<ChatResponse> {
    try {
      logger.info('Handling DOCUMENT query', { query, language });
      
      // Retrieve relevant context
      let context: string;
      let sources: any[];
      
      try {
        const retrievalResult = await retriever.retrieveContext(query);
        context = retrievalResult.context;
        sources = retrievalResult.sources;
        
        logger.info('Retrieval completed', { 
          contextLength: context?.length || 0,
          sourcesFound: sources?.length || 0 
        });
      } catch (retrievalError) {
        logger.error('Retrieval failed', { error: retrievalError, query });
        // Return not-found message instead of error
        const notFoundMessage = language === 'tr'
          ? 'Bu bilgi mevcut dokümanlarda bulunamadı.'
          : 'This information was not found in the available documents.';
        
        return {
          answer: notFoundMessage,
          sources: [],
          queryType: QueryType.DOCUMENT,
          language,
          confidence: 0.3,
          processingTime: Date.now() - startTime,
          warnings: ['Document retrieval failed']
        };
      }

      // Check if we have context
      if (!context || context.length === 0 || !sources || sources.length === 0) {
        logger.info('No relevant documents found for query');
        
        // Return specific "not found" message (NOT a generic error)
        const notFoundMessage = language === 'tr'
          ? 'Bu bilgi mevcut dokümanlarda bulunamadı. Lütfen farklı bir şekilde sormayı deneyin.'
          : 'This information was not found in the available documents. Please try rephrasing your question.';
        
        return {
          answer: notFoundMessage,
          sources: [],
          queryType: QueryType.DOCUMENT,
          language,
          confidence: 0.3,
          processingTime: Date.now() - startTime,
          warnings: ['No relevant documents found']
        };
      }

      // Generate answer using LLM
      let llmResponse;
      try {
        llmResponse = await llmService.generateAnswer(query, context, language);
        logger.info('LLM response generated', { answerLength: llmResponse.answer.length });
      } catch (llmError) {
        logger.error('LLM generation failed', { error: llmError, query });
        
        // Return not-found message instead of error
        const notFoundMessage = language === 'tr'
          ? 'Bu bilgi mevcut dokümanlarda bulunamadı.'
          : 'This information was not found in the available documents.';
        
        return {
          answer: notFoundMessage,
          sources: [],
          queryType: QueryType.DOCUMENT,
          language,
          confidence: 0.3,
          processingTime: Date.now() - startTime,
          warnings: ['Answer generation failed']
        };
      }

      // Convert sources to the expected format
      const formattedSources: Source[] = sources.map(s => ({
        documentId: s.chunk.documentId,
        filename: s.chunk.metadata.filename,
        pageNumber: s.chunk.pageNumber,
        excerpt: s.chunk.content.substring(0, 200) + '...',
        relevanceScore: s.score
      }));

      // Ensure answer is a valid string
      const finalAnswer = typeof llmResponse.answer === 'string' && llmResponse.answer.trim().length > 0
        ? llmResponse.answer
        : (language === 'tr' 
            ? 'Bu bilgi mevcut dokümanlarda bulunamadı.'
            : 'This information was not found in the available documents.');

      return {
        answer: finalAnswer,
        sources: formattedSources,
        queryType: QueryType.DOCUMENT,
        language,
        confidence: 0.85,
        processingTime: Date.now() - startTime,
        tokenUsage: llmResponse.tokenUsage
      };

    } catch (error) {
      // Final catch-all: MUST NOT return generic error for DOCUMENT queries
      logger.error('CRITICAL: Document query handler failed completely', { 
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack
        } : error,
        query 
      });
      
      // Return NOT-FOUND message, NOT a generic error
      const notFoundMessage = language === 'tr'
        ? 'Bu bilgi mevcut dokümanlarda bulunamadı.'
        : 'This information was not found in the available documents.';
      
      return {
        answer: notFoundMessage,
        sources: [],
        queryType: QueryType.DOCUMENT,
        language,
        confidence: 0.2,
        processingTime: Date.now() - startTime,
        warnings: ['Critical processing error - treated as not found']
      };
    }
  }

  /**
   * Handle general queries (greetings, etc.)
   */
  private async handleGeneralQuery(
    _query: string,
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
    _query: string,
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
   * Create a safe error response - NEVER returns null/undefined
   */
  private createSafeResponse(
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
      warnings: ['Processing issue occurred']
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
