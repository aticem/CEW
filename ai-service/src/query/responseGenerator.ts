/**
 * Response Generator Module (Orchestrator)
 * @module query/responseGenerator
 * 
 * Main pipeline for processing user queries.
 * Orchestrates validation, classification, retrieval, and generation.
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  ChatRequest, 
  ChatResponse, 
  QueryType, 
  Source,
  DocumentSource,
} from '../types';
import { validateInput, detectLanguage, SupportedLanguage } from '../services/policyService';
import { classifyQuery, QueryClassification } from './queryClassifier';
import { retrieveRelevantChunks, formatContextForLLM, RetrievedChunk, getRetrievalSummary } from './retriever';
import { generateResponse as llmGenerateResponse, GenerateResponseResult } from '../services/llmService';
import { 
  getSnapshotFromQuery, 
  hasModuleSnapshots, 
  NormalizedSnapshot,
  getAllModuleSnapshots,
} from '../connectors/cewSnapshotConnector';
import { 
  isQAQCCountQuery, 
  generateQAQCCountResponse,
} from '../connectors/qaqcSnapshotConnector';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * Processing metrics for logging
 */
interface ProcessingMetrics {
  validationTimeMs: number;
  classificationTimeMs: number;
  retrievalTimeMs: number;
  generationTimeMs: number;
  totalTimeMs: number;
}

/**
 * Internal processing context
 */
interface ProcessingContext {
  startTime: number;
  conversationId: string;
  language: SupportedLanguage;
  queryType: QueryType;
  classification: QueryClassification | null;
  chunks: RetrievedChunk[];
  metrics: Partial<ProcessingMetrics>;
}

// ============================================================================
// Constants
// ============================================================================

/** MVP messages for unsupported query types */
const MVP_MESSAGES = {
  data: {
    tr: 'Üretim verisi sorguları yakında eklenecektir. Şu an için sadece doküman tabanlı sorguları yanıtlayabiliyorum.',
    en: 'Production data queries will be available soon. Currently, I can only answer document-based queries.',
  },
  hybrid: {
    tr: 'Karma sorgular (doküman + veri) yakında eklenecektir. Şu an için sadece doküman tabanlı sorguları yanıtlayabiliyorum.',
    en: 'Hybrid queries (document + data) will be available soon. Currently, I can only answer document-based queries.',
  },
  noResults: {
    tr: 'Bu sorguyla ilgili herhangi bir doküman bulunamadı. Lütfen sorunuzu farklı kelimelerle tekrar deneyin.',
    en: 'No documents were found related to this query. Please try rephrasing your question.',
  },
  validationError: {
    tr: 'Giriş doğrulanamadı.',
    en: 'Input validation failed.',
  },
  systemError: {
    tr: 'Bir sistem hatası oluştu. Lütfen daha sonra tekrar deneyin.',
    en: 'A system error occurred. Please try again later.',
  },
  noSnapshot: {
    tr: 'Bu modül için henüz kayıtlı bir üretim verisi bulunmamaktadır. Lütfen önce bir iş kaydı girin.',
    en: 'No production data has been recorded for this module yet. Please submit work entries first.',
  },
  ambiguousModule: {
    tr: 'Hangi modül için bilgi istediğinizi belirleyemedim. Lütfen daha spesifik olun (örn: DC, LV, MC4, panel).',
    en: 'I could not determine which module you are asking about. Please be more specific (e.g., DC, LV, MC4, panel).',
  },
};

/** Default options */
const DEFAULT_OPTIONS = {
  maxSources: 5,
  scoreThreshold: 0.7,
  maxRetries: 1,
};

// ============================================================================
// Main Pipeline
// ============================================================================

/**
 * Process a user query through the complete pipeline
 * 
 * Pipeline:
 * 1. Validate input (policy service)
 * 2. Detect language
 * 3. Classify query
 * 4. If document query: retrieve → format → generate
 * 5. If data/hybrid: return MVP message
 * 
 * @param request - Chat request from client
 * @returns Chat response with answer and sources
 * 
 * @example
 * ```typescript
 * const response = await processQuery({
 *   message: 'What is the acceptance criteria for DC cables?',
 *   maxSources: 5,
 * });
 * 
 * console.log(response.message);
 * console.log(`Sources: ${response.sources.length}`);
 * ```
 */
export async function processQuery(request: ChatRequest): Promise<ChatResponse> {
  const startTime = Date.now();
  const conversationId = request.conversationId || `conv_${uuidv4()}`;

  logger.info('Processing query', {
    conversationId,
    queryPreview: request.message.substring(0, 100),
    providedQueryType: request.queryType,
  });

  // Initialize processing context
  const ctx: ProcessingContext = {
    startTime,
    conversationId,
    language: 'en',
    queryType: 'document',
    classification: null,
    chunks: [],
    metrics: {},
  };

  try {
    // Step 1: Validate input
    const validationResult = await validateInputStep(request.message, ctx);
    if (!validationResult.valid) {
      return buildErrorResponse(
        validationResult.rejection || MVP_MESSAGES.validationError[ctx.language],
        ctx,
        'validation_failed'
      );
    }

    // Use sanitized input
    const sanitizedQuery = validationResult.sanitized;
    ctx.language = validationResult.language;

    // Step 2: Classify query
    await classifyQueryStep(sanitizedQuery, request.queryType, ctx);

    // Step 3: Route based on query type
    
    // First, check if this is a QAQC count/status query (before data queries)
    // This has priority since QAQC count queries should not use LLM
    if (isQAQCCountQuery(sanitizedQuery)) {
      logger.info('QAQC count query - using snapshot connector', { conversationId });
      return await processQAQCCountQuery(sanitizedQuery, ctx);
    }

    if (ctx.queryType === 'data') {
      // Handle data queries using production snapshots
      logger.info('Data query - using snapshot connector', { conversationId });
      return await processDataQuery(sanitizedQuery, ctx);
    }

    if (ctx.queryType === 'hybrid') {
      // MVP: Hybrid queries not yet supported
      logger.info('Hybrid query - returning MVP message', { conversationId });
      return buildMVPResponse('hybrid', ctx);
    }

    // Step 4: Document query - full pipeline
    return await processDocumentQuery(sanitizedQuery, request, ctx);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Query processing failed', {
      conversationId,
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return buildErrorResponse(
      MVP_MESSAGES.systemError[ctx.language],
      ctx,
      'system_error'
    );
  }
}

// ============================================================================
// Pipeline Steps
// ============================================================================

/**
 * Step 1: Validate input
 */
async function validateInputStep(
  message: string,
  ctx: ProcessingContext
): Promise<{ valid: boolean; sanitized: string; language: SupportedLanguage; rejection?: string }> {
  const stepStart = Date.now();

  const result = validateInput(message);
  
  ctx.metrics.validationTimeMs = Date.now() - stepStart;
  ctx.language = result.language;

  logger.debug('Validation completed', {
    conversationId: ctx.conversationId,
    valid: result.valid,
    language: result.language,
    timeMs: ctx.metrics.validationTimeMs,
  });

  return result;
}

/**
 * Step 2: Classify query
 */
async function classifyQueryStep(
  query: string,
  providedType: QueryType | undefined,
  ctx: ProcessingContext
): Promise<void> {
  const stepStart = Date.now();

  // Use provided type or classify
  if (providedType) {
    ctx.queryType = providedType;
    ctx.classification = {
      type: providedType,
      confidence: 1.0,
      keywords: [],
      intent: 'provided',
      shouldFetchData: false,
      shouldRetrieveDocuments: providedType === 'document' || providedType === 'hybrid',
      language: ctx.language,
    };
  } else {
    ctx.classification = classifyQuery(query);
    ctx.queryType = ctx.classification.type;
  }

  ctx.metrics.classificationTimeMs = Date.now() - stepStart;

  logger.debug('Classification completed', {
    conversationId: ctx.conversationId,
    queryType: ctx.queryType,
    confidence: ctx.classification?.confidence,
    intent: ctx.classification?.intent,
    timeMs: ctx.metrics.classificationTimeMs,
  });
}

/**
 * Step 3a: Process data query using production snapshots
 * 
 * Generates response WITHOUT LLM - uses pre-calculated values from CEW frontend.
 */
async function processDataQuery(
  query: string,
  ctx: ProcessingContext
): Promise<ChatResponse> {
  ctx.metrics.totalTimeMs = Date.now() - ctx.startTime;

  // Check if any snapshots exist
  if (!hasModuleSnapshots()) {
    logger.info('No snapshots available', { conversationId: ctx.conversationId });
    return {
      success: true,
      message: MVP_MESSAGES.noSnapshot[ctx.language],
      conversationId: ctx.conversationId,
      sources: [],
      queryType: ctx.queryType,
      confidence: 1.0,
      metrics: {
        processingTimeMs: ctx.metrics.totalTimeMs || 0,
        chunksRetrieved: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Try to identify module from query
  const { snapshot, matchedModules, isAmbiguous } = getSnapshotFromQuery(query);

  // Handle ambiguous query
  if (isAmbiguous && matchedModules.length > 1) {
    logger.info('Ambiguous module query', { 
      conversationId: ctx.conversationId, 
      matchedModules,
    });
    return {
      success: true,
      message: MVP_MESSAGES.ambiguousModule[ctx.language],
      conversationId: ctx.conversationId,
      sources: [],
      queryType: ctx.queryType,
      confidence: 0.5,
      metrics: {
        processingTimeMs: ctx.metrics.totalTimeMs || 0,
        chunksRetrieved: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Handle no snapshot found
  if (!snapshot) {
    // Try to provide available modules list
    const availableSnapshots = getAllModuleSnapshots();
    if (availableSnapshots.length > 0) {
      const moduleList = availableSnapshots.map(s => s.moduleLabel).join(', ');
      const message = ctx.language === 'tr'
        ? `Bu sorgu için kayıtlı veri bulunamadı. Mevcut modüller: ${moduleList}`
        : `No data found for this query. Available modules: ${moduleList}`;
      
      return {
        success: true,
        message,
        conversationId: ctx.conversationId,
        sources: [],
        queryType: ctx.queryType,
        confidence: 0.7,
        metrics: {
          processingTimeMs: ctx.metrics.totalTimeMs || 0,
          chunksRetrieved: 0,
        },
        timestamp: new Date().toISOString(),
      };
    }
    
    return {
      success: true,
      message: MVP_MESSAGES.noSnapshot[ctx.language],
      conversationId: ctx.conversationId,
      sources: [],
      queryType: ctx.queryType,
      confidence: 1.0,
      metrics: {
        processingTimeMs: ctx.metrics.totalTimeMs || 0,
        chunksRetrieved: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Generate response from snapshot (NO LLM)
  const response = generateSnapshotResponse(snapshot, query, ctx.language);

  logger.info('Data query completed', {
    conversationId: ctx.conversationId,
    moduleKey: snapshot.moduleKey,
    today: snapshot.today,
    total: snapshot.total,
    remaining: snapshot.remaining,
  });

  return {
    success: true,
    message: response,
    conversationId: ctx.conversationId,
    sources: [{
      type: 'data',
      id: `snapshot_${snapshot.moduleKey}`,
      documentId: snapshot.moduleKey,
      filename: snapshot.moduleLabel,
      section: 'Production Snapshot',
      excerpt: `Today: ${snapshot.today}, Total: ${snapshot.total}, Remaining: ${snapshot.remaining}`,
      relevanceScore: 1.0,
      category: 'production_data',
    } as DocumentSource],
    queryType: ctx.queryType,
    confidence: 1.0,
    metrics: {
      processingTimeMs: ctx.metrics.totalTimeMs || 0,
      chunksRetrieved: 0,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Step 3b: Process QAQC count/status query
 * 
 * Generates response WITHOUT LLM - uses QAQC snapshot from CEW frontend.
 */
async function processQAQCCountQuery(
  query: string,
  ctx: ProcessingContext
): Promise<ChatResponse> {
  ctx.metrics.totalTimeMs = Date.now() - ctx.startTime;

  // Generate deterministic response (NO LLM)
  const response = generateQAQCCountResponse(query, ctx.language);

  logger.info('QAQC count query completed', {
    conversationId: ctx.conversationId,
    query: query.substring(0, 50),
    language: ctx.language,
  });

  return {
    success: true,
    message: response,
    conversationId: ctx.conversationId,
    sources: [{
      type: 'data',
      id: 'qaqc_snapshot',
      documentId: 'qaqc_status',
      filename: 'QAQC Status',
      section: 'Document Status Snapshot',
      excerpt: 'Real-time QAQC document status counts',
      relevanceScore: 1.0,
      category: 'qaqc_data',
    } as DocumentSource],
    queryType: 'data',
    confidence: 1.0,
    metrics: {
      processingTimeMs: ctx.metrics.totalTimeMs || 0,
      chunksRetrieved: 0,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate natural language response from snapshot
 * 
 * @param snapshot - Module snapshot
 * @param query - Original query for context
 * @param language - Response language
 */
function generateSnapshotResponse(
  snapshot: NormalizedSnapshot,
  query: string,
  language: SupportedLanguage
): string {
  const { moduleLabel, today, total, remaining, unit } = snapshot;
  const normalizedQuery = query.toLowerCase();

  // Detect what aspect of data user is asking about
  const askingToday = /bugün|today|günlük|daily/.test(normalizedQuery);
  const askingTotal = /toplam|total|tüm|all/.test(normalizedQuery);
  const askingRemaining = /kalan|remaining|geriye|left|eksik/.test(normalizedQuery);

  // Format unit text
  const unitText = unit ? ` ${unit}` : '';

  if (language === 'tr') {
    // Turkish response
    if (askingToday && !askingTotal && !askingRemaining) {
      return `Bugün ${moduleLabel} için ${today}${unitText} iş tamamlandı.`;
    }
    if (askingRemaining && !askingToday && !askingTotal) {
      return `${moduleLabel} için kalan iş miktarı ${remaining}${unitText}.`;
    }
    if (askingTotal && !askingToday && !askingRemaining) {
      return `${moduleLabel} için toplam tamamlanan iş miktarı ${total}${unitText}.`;
    }
    
    // Default: show all stats
    return `📊 **${moduleLabel}** Durumu:\n\n` +
           `• Bugün tamamlanan: **${today}${unitText}**\n` +
           `• Toplam tamamlanan: **${total}${unitText}**\n` +
           `• Kalan iş miktarı: **${remaining}${unitText}**`;
  } else {
    // English response
    if (askingToday && !askingTotal && !askingRemaining) {
      return `Today, ${today}${unitText} of work was completed for ${moduleLabel}.`;
    }
    if (askingRemaining && !askingToday && !askingTotal) {
      return `Remaining work for ${moduleLabel}: ${remaining}${unitText}.`;
    }
    if (askingTotal && !askingToday && !askingRemaining) {
      return `Total work completed for ${moduleLabel}: ${total}${unitText}.`;
    }
    
    // Default: show all stats
    return `📊 **${moduleLabel}** Status:\n\n` +
           `• Completed today: **${today}${unitText}**\n` +
           `• Total completed: **${total}${unitText}**\n` +
           `• Remaining: **${remaining}${unitText}**`;
  }
}

/**
 * Step 4: Process document query (retrieve + generate)
 */
async function processDocumentQuery(
  query: string,
  request: ChatRequest,
  ctx: ProcessingContext
): Promise<ChatResponse> {
  // Step 4a: Retrieve relevant chunks
  const retrievalStart = Date.now();
  
  try {
    ctx.chunks = await retrieveRelevantChunks(query, {
      topK: request.maxSources || DEFAULT_OPTIONS.maxSources,
      scoreThreshold: DEFAULT_OPTIONS.scoreThreshold,
      filter: request.filters ? {
        documentIds: request.filters.documentIds,
        source: request.filters.categories?.[0],
      } : undefined,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Retrieval failed', {
      conversationId: ctx.conversationId,
      error: errorMsg,
    });
    ctx.chunks = [];
  }

  ctx.metrics.retrievalTimeMs = Date.now() - retrievalStart;

  // Log retrieval results
  const retrievalSummary = getRetrievalSummary(ctx.chunks);
  logger.debug('Retrieval completed', {
    conversationId: ctx.conversationId,
    chunksFound: ctx.chunks.length,
    sources: retrievalSummary.sources,
    topScore: retrievalSummary.topScore,
    timeMs: ctx.metrics.retrievalTimeMs,
  });

  // Handle no results
  if (ctx.chunks.length === 0) {
    logger.info('No relevant documents found', { conversationId: ctx.conversationId });
    return buildNoResultsResponse(ctx);
  }

  // Step 4b: Format context for LLM
  const context = formatContextForLLM(ctx.chunks);

  // Step 4c: Generate response with retry
  const generationStart = Date.now();
  let llmResult: GenerateResponseResult | null = null;
  let retryCount = 0;

  while (retryCount <= DEFAULT_OPTIONS.maxRetries) {
    try {
      llmResult = await llmGenerateResponse({
        query,
        context,
        language: ctx.language,
        queryType: ctx.queryType,
        temperature: request.modelConfig?.temperature,
        maxTokens: request.modelConfig?.maxTokens,
      });
      break; // Success
    } catch (error) {
      retryCount++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      if (retryCount <= DEFAULT_OPTIONS.maxRetries) {
        logger.warn('LLM generation failed, retrying', {
          conversationId: ctx.conversationId,
          attempt: retryCount,
          error: errorMsg,
        });
        await sleep(1000 * retryCount); // Backoff
      } else {
        logger.error('LLM generation failed after retries', {
          conversationId: ctx.conversationId,
          attempts: retryCount,
          error: errorMsg,
        });
      }
    }
  }

  ctx.metrics.generationTimeMs = Date.now() - generationStart;
  ctx.metrics.totalTimeMs = Date.now() - ctx.startTime;

  // Handle LLM failure
  if (!llmResult) {
    return buildErrorResponse(
      MVP_MESSAGES.systemError[ctx.language],
      ctx,
      'generation_failed'
    );
  }

  // Step 4d: Extract sources
  const sources = extractSources(ctx.chunks);

  // Log completion
  logQueryCompletion(ctx, llmResult, sources);

  // Build and return response
  return {
    success: true,
    message: llmResult.answer,
    conversationId: ctx.conversationId,
    sources,
    queryType: ctx.queryType,
    confidence: calculateConfidence(ctx.chunks, llmResult.finishReason),
    metrics: {
      processingTimeMs: ctx.metrics.totalTimeMs || 0,
      chunksRetrieved: ctx.chunks.length,
      tokenUsage: {
        promptTokens: llmResult.promptTokens,
        completionTokens: llmResult.completionTokens,
        totalTokens: llmResult.tokensUsed,
      },
    },
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Response Builders
// ============================================================================

/**
 * Build MVP response for unsupported query types
 */
function buildMVPResponse(
  type: 'data' | 'hybrid',
  ctx: ProcessingContext
): ChatResponse {
  ctx.metrics.totalTimeMs = Date.now() - ctx.startTime;

  return {
    success: true,
    message: MVP_MESSAGES[type][ctx.language],
    conversationId: ctx.conversationId,
    sources: [],
    queryType: ctx.queryType,
    confidence: 1.0,
    metrics: {
      processingTimeMs: ctx.metrics.totalTimeMs || 0,
      chunksRetrieved: 0,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build response for no results
 */
function buildNoResultsResponse(ctx: ProcessingContext): ChatResponse {
  ctx.metrics.totalTimeMs = Date.now() - ctx.startTime;

  return {
    success: true,
    message: MVP_MESSAGES.noResults[ctx.language],
    conversationId: ctx.conversationId,
    sources: [],
    queryType: ctx.queryType,
    confidence: 0,
    metrics: {
      processingTimeMs: ctx.metrics.totalTimeMs || 0,
      chunksRetrieved: 0,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build error response
 */
function buildErrorResponse(
  message: string,
  ctx: ProcessingContext,
  errorCode: string
): ChatResponse {
  ctx.metrics.totalTimeMs = Date.now() - ctx.startTime;

  return {
    success: false,
    message,
    conversationId: ctx.conversationId,
    sources: [],
    queryType: ctx.queryType,
    confidence: 0,
    metrics: {
      processingTimeMs: ctx.metrics.totalTimeMs || 0,
      chunksRetrieved: 0,
    },
    error: {
      code: errorCode,
      message,
    },
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract sources from retrieved chunks
 */
function extractSources(chunks: RetrievedChunk[]): Source[] {
  const sources: DocumentSource[] = [];
  const seenDocs = new Set<string>();

  for (const { chunk, score, document } of chunks) {
    // Create unique key for deduplication
    const docKey = `${document.id}_${chunk.pageNumber || 0}`;
    
    if (seenDocs.has(docKey)) {
      continue;
    }
    seenDocs.add(docKey);

    sources.push({
      type: 'document',
      id: chunk.id,
      documentId: document.id,
      filename: document.filename,
      pageNumber: chunk.pageNumber,
      section: chunk.headings?.[0],
      excerpt: chunk.content.substring(0, 200) + (chunk.content.length > 200 ? '...' : ''),
      relevanceScore: score,
      category: document.category,
    });
  }

  return sources;
}

/**
 * Calculate confidence score
 */
function calculateConfidence(
  chunks: RetrievedChunk[],
  finishReason: string
): number {
  if (chunks.length === 0) {
    return 0;
  }

  // Base confidence on retrieval scores
  const avgScore = chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;
  const topScore = Math.max(...chunks.map(c => c.score));

  // Weighted average: 60% top score, 40% average
  let confidence = topScore * 0.6 + avgScore * 0.4;

  // Penalize if LLM didn't finish normally
  if (finishReason !== 'stop') {
    confidence *= 0.8;
  }

  // Clamp to valid range
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Log query completion with full metrics
 */
function logQueryCompletion(
  ctx: ProcessingContext,
  llmResult: GenerateResponseResult,
  sources: Source[]
): void {
  logger.info('Query completed', {
    conversationId: ctx.conversationId,
    queryType: ctx.queryType,
    language: ctx.language,
    chunksRetrieved: ctx.chunks.length,
    sourcesUsed: sources.length,
    sourceFiles: sources.map(s => (s as DocumentSource).filename),
    tokensUsed: llmResult.tokensUsed,
    answerLength: llmResult.answer.length,
    metrics: {
      validationMs: ctx.metrics.validationTimeMs,
      classificationMs: ctx.metrics.classificationTimeMs,
      retrievalMs: ctx.metrics.retrievalTimeMs,
      generationMs: ctx.metrics.generationTimeMs,
      totalMs: ctx.metrics.totalTimeMs,
    },
  });
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Exports
// ============================================================================

export default {
  processQuery,
};
