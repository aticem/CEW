/**
 * LLM Service Module
 * @module services/llmService
 * 
 * Handles interactions with OpenAI for response generation.
 * Enforces strict context-only answers with no hallucination.
 */

import OpenAI from 'openai';
import { config } from '../config';
import { logger } from './loggerService';
import { QueryType } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters for generating a response
 */
export interface GenerateResponseParams {
  /** User's query */
  query: string;
  /** Retrieved context from documents */
  context: string;
  /** Response language */
  language: 'tr' | 'en';
  /** Query classification type */
  queryType: QueryType;
  /** Optional conversation history */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Override default temperature */
  temperature?: number;
  /** Override default max tokens */
  maxTokens?: number;
}

/**
 * Response from LLM generation
 */
export interface GenerateResponseResult {
  /** Generated answer */
  answer: string;
  /** Total tokens used (prompt + completion) */
  tokensUsed: number;
  /** Model used */
  model: string;
  /** Prompt tokens */
  promptTokens: number;
  /** Completion tokens */
  completionTokens: number;
  /** Processing time in ms */
  processingTimeMs: number;
  /** Finish reason */
  finishReason: string;
}

/**
 * LLM Service configuration
 */
export interface LLMServiceConfig {
  /** API key */
  apiKey: string;
  /** Model to use */
  model: string;
  /** Default temperature */
  temperature: number;
  /** Default max tokens */
  maxTokens: number;
  /** Request timeout in ms */
  timeout: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base delay for retry backoff */
  retryDelayMs: number;
}

/**
 * Token usage tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default configuration */
const DEFAULT_CONFIG: LLMServiceConfig = {
  apiKey: config.llm.apiKey,
  model: config.llm.model || 'gpt-4-turbo-preview',
  temperature: config.llm.temperature || 0.7,
  maxTokens: config.llm.maxTokens || 2000,
  timeout: 60000,
  maxRetries: 3,
  retryDelayMs: 1000,
};

/** Token limits by model */
const MODEL_TOKEN_LIMITS: Record<string, number> = {
  'gpt-4-turbo-preview': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,
};

/** Cost per 1K tokens (approximate, USD) */
const TOKEN_COSTS: Record<string, { prompt: number; completion: number }> = {
  'gpt-4-turbo-preview': { prompt: 0.01, completion: 0.03 },
  'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
  'gpt-4': { prompt: 0.03, completion: 0.06 },
  'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
};

/** No information found messages */
const NO_INFO_MESSAGES = {
  tr: 'Bu bilgi mevcut dokümanlarda bulunamadı.',
  en: 'This information was not found in available documents.',
};

/** System prompt templates by language */
const SYSTEM_PROMPTS = {
  tr: `Sen CEW AI Asistanı'sın - teknik bir inşaat asistanısın.

KESİN KURALLAR:
- SADECE sağlanan bağlamı kullanarak cevap ver
- Eğer bilgi bağlamda yoksa, şunu söyle: "${NO_INFO_MESSAGES.tr}"
- ASLA tahmin yapma veya bilgi uydurma
- HER ZAMAN kaynaklara atıfta bulun (dosya adı ve sayfa numarası)
- Türkçe yanıt ver
- Kısa ve teknik ol
- Belirsizlik varsa, belirt

BAĞLAM:
{context}`,

  en: `You are CEW AI Assistant - a technical construction assistant.

STRICT RULES:
- Answer ONLY using the provided context
- If information is not in context, say: "${NO_INFO_MESSAGES.en}"
- NEVER guess or invent information
- ALWAYS cite sources (filename and page number)
- Respond in English
- Be concise and technical
- If uncertain, state it clearly

CONTEXT:
{context}`,
};

/** Query type specific instructions */
const QUERY_TYPE_INSTRUCTIONS = {
  document: {
    tr: '\nBu bir doküman sorgusu. Prosedürler, standartlar veya teknik spesifikasyonlar hakkında bilgi ver.',
    en: '\nThis is a document query. Provide information about procedures, standards, or technical specifications.',
  },
  data: {
    tr: '\nBu bir veri sorgusu. Not: Gerçek zamanlı veri şu anda mevcut değil. Sadece dokümanlardaki bilgiye dayanarak cevap ver.',
    en: '\nThis is a data query. Note: Real-time data is not currently available. Answer based only on document information.',
  },
  hybrid: {
    tr: '\nBu karma bir sorgu. Dokümanlardaki bilgiyi kullan. Gerçek zamanlı veri mevcut değil.',
    en: '\nThis is a hybrid query. Use document information. Real-time data is not available.',
  },
};

// ============================================================================
// Service State
// ============================================================================

let openaiClient: OpenAI | null = null;
let totalTokensUsed = 0;
let totalCost = 0;
let requestCount = 0;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the LLM service
 * @param customConfig - Optional custom configuration
 */
export function initializeLLMService(customConfig?: Partial<LLMServiceConfig>): void {
  const finalConfig = { ...DEFAULT_CONFIG, ...customConfig };

  if (!finalConfig.apiKey) {
    throw new Error('OpenAI API key is required');
  }

  openaiClient = new OpenAI({
    apiKey: finalConfig.apiKey,
    timeout: finalConfig.timeout,
    maxRetries: finalConfig.maxRetries,
  });

  logger.info('LLM service initialized', {
    model: finalConfig.model,
    temperature: finalConfig.temperature,
    maxTokens: finalConfig.maxTokens,
  });
}

/**
 * Ensure service is initialized
 */
function ensureInitialized(): OpenAI {
  if (!openaiClient) {
    initializeLLMService();
  }
  return openaiClient!;
}

// ============================================================================
// Main Generation Function
// ============================================================================

/**
 * Generate a response using the LLM
 * 
 * Enforces strict context-only answers with no hallucination.
 * 
 * @param params - Generation parameters
 * @returns Generated response with token usage
 * 
 * @example
 * ```typescript
 * const result = await generateResponse({
 *   query: 'What is the acceptance criteria for DC cables?',
 *   context: '[Source: QAQC.pdf, Page 5]\nAcceptance criteria include...',
 *   language: 'en',
 *   queryType: 'document',
 * });
 * 
 * console.log(result.answer);
 * console.log(`Tokens used: ${result.tokensUsed}`);
 * ```
 */
export async function generateResponse(
  params: GenerateResponseParams
): Promise<GenerateResponseResult> {
  const startTime = Date.now();
  const client = ensureInitialized();

  const {
    query,
    context,
    language,
    queryType,
    history = [],
    temperature = DEFAULT_CONFIG.temperature,
    maxTokens = DEFAULT_CONFIG.maxTokens,
  } = params;

  logger.debug('Generating response', {
    queryPreview: query.substring(0, 100),
    language,
    queryType,
    contextLength: context.length,
    historyLength: history.length,
  });

  // Build system prompt
  const systemPrompt = buildSystemPrompt(context, language, queryType);

  // Build messages array
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current query
  messages.push({ role: 'user', content: query });

  // Check token limits
  const estimatedPromptTokens = estimateTokens(messages);
  const modelLimit = MODEL_TOKEN_LIMITS[DEFAULT_CONFIG.model] || 8192;
  
  if (estimatedPromptTokens > modelLimit * 0.9) {
    logger.warn('Prompt may exceed token limit', {
      estimated: estimatedPromptTokens,
      limit: modelLimit,
    });
  }

  // Call OpenAI API with retry
  let response: OpenAI.Chat.Completions.ChatCompletion;
  
  try {
    response = await callWithRetry(client, messages, temperature, maxTokens);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('LLM generation failed', { error: errorMsg });
    
    // Return fallback response on error
    return {
      answer: NO_INFO_MESSAGES[language],
      tokensUsed: 0,
      model: DEFAULT_CONFIG.model,
      promptTokens: 0,
      completionTokens: 0,
      processingTimeMs: Date.now() - startTime,
      finishReason: 'error',
    };
  }

  // Extract response
  const completion = response.choices[0];
  const answer = completion.message?.content || NO_INFO_MESSAGES[language];
  const finishReason = completion.finish_reason || 'unknown';

  // Track usage
  const usage = response.usage;
  const promptTokens = usage?.prompt_tokens || 0;
  const completionTokens = usage?.completion_tokens || 0;
  const tokensUsed = promptTokens + completionTokens;

  // Update global tracking
  updateUsageTracking(promptTokens, completionTokens);

  const processingTimeMs = Date.now() - startTime;

  logger.info('Response generated', {
    tokensUsed,
    promptTokens,
    completionTokens,
    finishReason,
    processingTimeMs,
    answerLength: answer.length,
  });

  return {
    answer,
    tokensUsed,
    model: response.model,
    promptTokens,
    completionTokens,
    processingTimeMs,
    finishReason,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build the system prompt with context
 */
function buildSystemPrompt(
  context: string,
  language: 'tr' | 'en',
  queryType: QueryType
): string {
  let prompt = SYSTEM_PROMPTS[language].replace('{context}', context || 'No context provided.');
  
  // Add query type specific instructions
  prompt += QUERY_TYPE_INSTRUCTIONS[queryType][language];

  return prompt;
}

/**
 * Call OpenAI API with retry logic for rate limits
 */
async function callWithRetry(
  client: OpenAI,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  temperature: number,
  maxTokens: number,
  attempt: number = 0
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  try {
    return await client.chat.completions.create({
      model: DEFAULT_CONFIG.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });
  } catch (error) {
    const isRateLimited = 
      (error as { status?: number })?.status === 429 ||
      (error instanceof Error && error.message.includes('429'));

    if (isRateLimited && attempt < DEFAULT_CONFIG.maxRetries) {
      const delay = DEFAULT_CONFIG.retryDelayMs * Math.pow(2, attempt);
      
      logger.warn('Rate limited, retrying', {
        attempt: attempt + 1,
        delayMs: delay,
      });

      await sleep(delay);
      return callWithRetry(client, messages, temperature, maxTokens, attempt + 1);
    }

    throw error;
  }
}

/**
 * Estimate token count for messages
 * Rough estimate: ~4 characters per token
 */
function estimateTokens(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): number {
  let totalChars = 0;
  
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    }
  }

  // Add overhead for message formatting
  return Math.ceil(totalChars / 4) + (messages.length * 4);
}

/**
 * Update global usage tracking
 */
function updateUsageTracking(promptTokens: number, completionTokens: number): void {
  const model = DEFAULT_CONFIG.model;
  const costs = TOKEN_COSTS[model] || { prompt: 0.01, completion: 0.03 };

  totalTokensUsed += promptTokens + completionTokens;
  totalCost += (promptTokens / 1000) * costs.prompt + (completionTokens / 1000) * costs.completion;
  requestCount++;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Count tokens in text (estimate)
 * @param text - Text to count
 * @returns Estimated token count
 */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if content fits within model limits
 * @param systemPrompt - System prompt
 * @param userPrompt - User prompt
 * @param context - Context content
 * @returns Fit check result
 */
export function checkContextLimit(
  systemPrompt: string,
  userPrompt: string,
  context: string
): { fits: boolean; totalTokens: number; maxTokens: number; remaining: number } {
  const totalTokens = countTokens(systemPrompt + userPrompt + context);
  const maxTokens = MODEL_TOKEN_LIMITS[DEFAULT_CONFIG.model] || 8192;
  const reserveForResponse = DEFAULT_CONFIG.maxTokens;
  const available = maxTokens - reserveForResponse;

  return {
    fits: totalTokens < available,
    totalTokens,
    maxTokens,
    remaining: available - totalTokens,
  };
}

/**
 * Truncate context to fit within limits
 * @param context - Context string
 * @param maxTokens - Maximum tokens allowed
 * @returns Truncated context
 */
export function truncateContext(context: string, maxTokens: number): string {
  const currentTokens = countTokens(context);
  
  if (currentTokens <= maxTokens) {
    return context;
  }

  // Truncate to fit (roughly 4 chars per token)
  const targetChars = maxTokens * 4;
  const truncated = context.substring(0, targetChars);
  
  // Try to truncate at a natural break point
  const lastBreak = Math.max(
    truncated.lastIndexOf('\n\n'),
    truncated.lastIndexOf('\n'),
    truncated.lastIndexOf('. ')
  );

  if (lastBreak > targetChars * 0.5) {
    return truncated.substring(0, lastBreak) + '\n\n[Context truncated...]';
  }

  return truncated + '\n\n[Context truncated...]';
}

// ============================================================================
// Usage Statistics
// ============================================================================

/**
 * Get usage statistics
 * @returns Current usage statistics
 */
export function getUsageStats(): {
  totalTokensUsed: number;
  totalCost: number;
  requestCount: number;
  avgTokensPerRequest: number;
} {
  return {
    totalTokensUsed,
    totalCost: Math.round(totalCost * 10000) / 10000,
    requestCount,
    avgTokensPerRequest: requestCount > 0 
      ? Math.round(totalTokensUsed / requestCount) 
      : 0,
  };
}

/**
 * Reset usage statistics
 */
export function resetUsageStats(): void {
  totalTokensUsed = 0;
  totalCost = 0;
  requestCount = 0;
  logger.info('Usage stats reset');
}

/**
 * Estimate cost for a request
 * @param promptTokens - Number of prompt tokens
 * @param completionTokens - Number of completion tokens
 * @returns Estimated cost in USD
 */
export function estimateCost(promptTokens: number, completionTokens: number): number {
  const costs = TOKEN_COSTS[DEFAULT_CONFIG.model] || { prompt: 0.01, completion: 0.03 };
  return (promptTokens / 1000) * costs.prompt + (completionTokens / 1000) * costs.completion;
}

// ============================================================================
// Exports
// ============================================================================

export default {
  initializeLLMService,
  generateResponse,
  countTokens,
  checkContextLimit,
  truncateContext,
  getUsageStats,
  resetUsageStats,
  estimateCost,
  NO_INFO_MESSAGES,
};
