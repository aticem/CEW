/**
 * LLM Service - Interacts with OpenAI's LLM for response generation
 */
import { OpenAI } from 'openai';
import { logger } from './logger';
import { policyService } from './policyService';
import { config } from '../config';

/**
 * LLM response with metadata
 */
export interface LLMResponse {
  answer: string;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
  model: string;
  finishReason: string;
}

/**
 * LLM Service class
 */
export class LLMService {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openaiApiKey,
    });
    this.model = config.llmModel;
    this.temperature = config.llmTemperature;
    this.maxTokens = config.maxTokens;

    logger.info('LLM Service initialized', {
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens
    });
  }

  /**
   * Generate an answer based on context and query
   * @param query - User's question
   * @param context - Retrieved context from documents
   * @param language - Detected language
   * @returns LLM response
   */
  async generateAnswer(
    query: string,
    context: string,
    language: string
  ): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      logger.info('Generating LLM response', {
        queryLength: query.length,
        contextLength: context.length,
        language
      });

      // Build prompt
      const systemPrompt = policyService.getSystemPrompt();
      const userPrompt = this.buildPrompt(query, context, language);

      // Call OpenAI
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      });

      const answer = response.choices[0]?.message?.content || '';
      const finishReason = response.choices[0]?.finish_reason || 'unknown';

      const duration = Date.now() - startTime;

      logger.info('LLM response generated', {
        answerLength: answer.length,
        finishReason,
        duration: `${duration}ms`,
        totalTokens: response.usage?.total_tokens || 0
      });

      // Validate response
      const validation = policyService.validateResponse(answer, context.length > 0);
      if (!validation.valid) {
        logger.warn('LLM response validation issues', { issues: validation.issues });
      }

      return {
        answer,
        tokenUsage: {
          prompt: response.usage?.prompt_tokens || 0,
          completion: response.usage?.completion_tokens || 0,
          total: response.usage?.total_tokens || 0
        },
        model: response.model,
        finishReason
      };

    } catch (error) {
      logger.error('LLM generation failed', { error });
      throw new Error(`LLM generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a simple response without context (for greetings, etc.)
   * @param query - User's query
   * @param language - Language code
   * @returns LLM response
   */
  async generateSimpleResponse(query: string, language: string): Promise<LLMResponse> {
    try {
      const systemPrompt = `You are a helpful AI assistant for the CEW system. 
Keep responses brief and friendly. 
Respond in ${language === 'tr' ? 'Turkish' : 'English'}.`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        temperature: 0.7,
        max_tokens: 200,
      });

      const answer = response.choices[0]?.message?.content || '';

      return {
        answer,
        tokenUsage: {
          prompt: response.usage?.prompt_tokens || 0,
          completion: response.usage?.completion_tokens || 0,
          total: response.usage?.total_tokens || 0
        },
        model: response.model,
        finishReason: response.choices[0]?.finish_reason || 'unknown'
      };

    } catch (error) {
      logger.error('Simple response generation failed', { error });
      throw error;
    }
  }

  /**
   * Build the user prompt with context
   * @param query - User's question
   * @param context - Document context
   * @param language - Language code
   * @returns Formatted prompt
   */
  private buildPrompt(query: string, context: string, language: string): string {
    const instructions = policyService.getDocumentInstructions();
    
    if (context && context.length > 0) {
      return `${instructions}

CONTEXT:
${context}

USER QUESTION (${language}):
${query}

Please provide a comprehensive answer based ONLY on the context above. Cite your sources by mentioning document filenames.`;
    } else {
      // No context available
      const noAnswerTemplate = policyService.getNoAnswerTemplate(language);
      return `The user asked: "${query}"

However, no relevant information was found in the indexed documents.

Please provide this response: ${noAnswerTemplate}`;
    }
  }

  /**
   * Test OpenAI connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10
      });

      logger.info('OpenAI LLM API connection successful');
      return true;
    } catch (error) {
      logger.error('OpenAI LLM API connection failed', { error });
      return false;
    }
  }

  /**
   * Estimate token count (rough approximation)
   * @param text - Text to estimate
   * @returns Estimated token count
   */
  estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if text fits within token limit
   * @param text - Text to check
   * @param limit - Token limit
   * @returns True if within limit
   */
  fitsTokenLimit(text: string, limit: number): boolean {
    const estimated = this.estimateTokens(text);
    return estimated <= limit;
  }
}

// Singleton instance
export const llmService = new LLMService();
export default llmService;
