import OpenAI from 'openai';
import logger from '../../utils/logger.js';
import config from '../../config/env.js';

// Initialize OpenAI client
let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient && config.openai.apiKey) {
    openaiClient = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }
  return openaiClient;
}

/**
 * Generate answer from LLM
 */
export async function generateAnswer(prompt, options = {}) {
  try {
    const client = getOpenAIClient();
    
    if (!client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY.');
    }

    const {
      model = config.openai.llmModel,
      temperature = 0.1, // Low temperature for factual responses
      maxTokens = 1000,
    } = options;

    logger.debug('Generating LLM answer', {
      model,
      temperature,
      promptLength: prompt.length,
    });

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature,
      max_tokens: maxTokens,
    });

    const answer = response.choices[0].message.content;

    logger.debug('LLM answer generated', {
      answerLength: answer.length,
      tokensUsed: response.usage.total_tokens,
    });

    return {
      answer,
      usage: response.usage,
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
 * Generate answer with system prompt
 */
export async function generateAnswerWithSystem(systemPrompt, userPrompt, options = {}) {
  try {
    const client = getOpenAIClient();
    
    if (!client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY.');
    }

    const {
      model = config.openai.llmModel,
      temperature = 0.1,
      maxTokens = 1000,
    } = options;

    logger.debug('Generating LLM answer with system prompt', {
      model,
      temperature,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
    });

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature,
      max_tokens: maxTokens,
    });

    const answer = response.choices[0].message.content;

    logger.debug('LLM answer generated', {
      answerLength: answer.length,
      tokensUsed: response.usage.total_tokens,
    });

    return {
      answer,
      usage: response.usage,
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
