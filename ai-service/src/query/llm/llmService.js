import Anthropic from '@anthropic-ai/sdk';
import logger from '../../utils/logger.js';
import config from '../../config/env.js';

// Initialize Anthropic client
let anthropicClient = null;

function getAnthropicClient() {
  if (!anthropicClient && config.anthropic.apiKey) {
    anthropicClient = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
  }
  return anthropicClient;
}

/**
 * Check if error is related to model not being available
 */
function isModelNotFoundError(error) {
  if (!error) return false;
  
  const errorMessage = error.message?.toLowerCase() || '';
  const errorType = error.type?.toLowerCase() || '';
  const statusCode = error.status || error.statusCode;
  
  // Check for model-related errors
  return (
    errorType === 'not_found_error' ||
    errorType === 'invalid_model' ||
    errorMessage.includes('model') && (errorMessage.includes('not found') || errorMessage.includes('invalid')) ||
    statusCode === 404 && errorMessage.includes('model')
  );
}

/**
 * Call Anthropic API with automatic fallback to stable model
 */
async function callAnthropicWithFallback(createMessageFn, requestedModel) {
  const preferredModel = requestedModel || config.anthropic.preferredModel;
  const fallbackModel = config.anthropic.fallbackModel;
  
  try {
    // Try with preferred model first
    logger.info('[LLM] Attempting request', { model: preferredModel });
    const response = await createMessageFn(preferredModel);
    logger.info('[LLM] Request successful', { 
      model: preferredModel,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });
    return { response, modelUsed: preferredModel };
  } catch (error) {
    // Check if error is due to model not being available
    if (isModelNotFoundError(error)) {
      logger.warn('[LLM] Preferred model unavailable', { 
        requestedModel: preferredModel,
        error: error.message,
      });
      logger.info('[LLM] Falling back to stable model', { 
        fallbackModel,
      });
      
      try {
        // Retry with fallback model
        const response = await createMessageFn(fallbackModel);
        logger.info('[LLM] Fallback request successful', { 
          model: fallbackModel,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
        });
        return { response, modelUsed: fallbackModel, fellback: true };
      } catch (fallbackError) {
        logger.error('[LLM] Fallback model also failed', {
          fallbackModel,
          error: fallbackError.message,
        });
        throw fallbackError;
      }
    } else {
      // Non-model-related error, throw immediately
      logger.error('[LLM] Request failed (non-model error)', {
        model: preferredModel,
        error: error.message,
      });
      throw error;
    }
  }
}

/**
 * Generate answer from LLM
 */
export async function generateAnswer(prompt, options = {}) {
  try {
    const client = getAnthropicClient();
    
    if (!client) {
      throw new Error('Anthropic client not initialized. Please set ANTHROPIC_API_KEY.');
    }

    const {
      model = config.anthropic.model,
      temperature = 0.1, // Low temperature for factual responses
      maxTokens = 1000,
    } = options;

    logger.debug('Generating LLM answer', {
      model,
      temperature,
      promptLength: prompt.length,
    });

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const answer = response.content[0].text;

    logger.debug('LLM answer generated', {
      answerLength: answer.length,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    return {
      answer,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  } catch (error) {
    logger.error('Error generating LLM answer', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Generate answer with system prompt (with automatic model fallback)
 */
export async function generateAnswerWithSystem(systemPrompt, userPrompt, options = {}) {
  try {
    const client = getAnthropicClient();
    
    if (!client) {
      throw new Error('Anthropic client not initialized. Please set ANTHROPIC_API_KEY.');
    }

    const {
      model = config.anthropic.preferredModel,
      temperature = 0.1,
      maxTokens = 1000,
    } = options;

    logger.debug('Generating LLM answer with system prompt', {
      requestedModel: model,
      temperature,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
    });

    // Create API call function for fallback mechanism
    const createMessageFn = async (modelToUse) => {
      return await client.messages.create({
        model: modelToUse,
        max_tokens: maxTokens,
        system: systemPrompt,
        temperature,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });
    };

    // Call with automatic fallback
    const { response, modelUsed, fellback } = await callAnthropicWithFallback(createMessageFn, model);

    const answer = response.content[0].text;

    logger.debug('LLM answer generated', {
      modelUsed,
      fellback: fellback || false,
      answerLength: answer.length,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    return {
      answer,
      modelUsed,
      fellback: fellback || false,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  } catch (error) {
    logger.error('Error generating LLM answer', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

export default {
  generateAnswer,
  generateAnswerWithSystem,
};
