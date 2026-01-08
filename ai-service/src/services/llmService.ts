import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { LLMRequest, LLMResponse } from '../types';
import { config } from '../config';
import { logger } from './logger';

class LLMService {
  private openaiClient: ChatOpenAI;

  constructor() {
    this.openaiClient = new ChatOpenAI({
      openAIApiKey: config.openai.apiKey,
      modelName: config.openai.model,
      temperature: 0.3,
    });
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      const messages = this.buildMessages(request);

      const response = await this.openaiClient.invoke(messages, {
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.maxTokens !== undefined && { maxTokens: request.maxTokens }),
      });

      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      const result: LLMResponse = {
        content,
        model: config.openai.model,
        tokensUsed: {
          prompt: response.usage_metadata?.input_tokens || 0,
          completion: response.usage_metadata?.output_tokens || 0,
          total: response.usage_metadata?.total_tokens || 0,
        },
        finishReason: response.response_metadata?.finish_reason || 'stop',
      };

      const processingTime = Date.now() - startTime;
      logger.debug('LLM response generated', {
        model: config.openai.model,
        tokensUsed: result.tokensUsed.total,
        processingTimeMs: processingTime,
      });

      return result;
    } catch (error) {
      logger.error('LLM request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private buildMessages(request: LLMRequest): (SystemMessage | HumanMessage)[] {
    const messages: (SystemMessage | HumanMessage)[] = [];

    if (request.systemPrompt) {
      messages.push(new SystemMessage(request.systemPrompt));
    }

    // Add context if provided
    let userContent = request.prompt;
    if (request.context && request.context.length > 0) {
      const contextStr = request.context.join('\n\n---\n\n');
      userContent = `Context:\n${contextStr}\n\nQuestion: ${request.prompt}`;
    }

    messages.push(new HumanMessage(userContent));

    return messages;
  }

  async streamResponse(
    request: LLMRequest,
    onChunk: (chunk: string) => void
  ): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      const messages = this.buildMessages(request);
      let fullContent = '';

      const stream = await this.openaiClient.stream(messages);

      for await (const chunk of stream) {
        const content = typeof chunk.content === 'string' ? chunk.content : '';
        fullContent += content;
        onChunk(content);
      }

      const processingTime = Date.now() - startTime;

      return {
        content: fullContent,
        model: config.openai.model,
        tokensUsed: {
          prompt: 0, // Not available in streaming
          completion: 0,
          total: 0,
        },
        finishReason: 'stop',
      };
    } catch (error) {
      logger.error('LLM streaming failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.generateResponse({
        prompt: 'Hello',
        maxTokens: 5,
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const llmService = new LLMService();
