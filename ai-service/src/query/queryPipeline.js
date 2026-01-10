import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { generateEmbedding } from '../ingest/embeddings/embeddingService.js';
import * as vectorDb from '../vector/vectorDbClient.js';
import { generateAnswerWithSystem } from './llm/llmService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache system prompt
let systemPrompt = null;

async function getSystemPrompt() {
  if (!systemPrompt) {
    const promptPath = join(__dirname, '../prompts/system/systemPrompt.txt');
    systemPrompt = await readFile(promptPath, 'utf-8');
  }
  return systemPrompt;
}

/**
 * Main query pipeline
 * Processes user question and returns answer with sources
 */
export async function processQuery(question, options = {}) {
  const startTime = Date.now();

  try {
    logger.info('Processing query', { question });

    // Validate question
    if (!question || question.trim().length === 0) {
      return {
        success: false,
        error: 'Question cannot be empty',
      };
    }

    // Step 1: Generate embedding for question
    logger.debug('Step 1: Generating query embedding');
    const queryEmbedding = await generateEmbedding(question);

    // Step 2: Retrieve relevant chunks from vector database
    logger.debug('Step 2: Retrieving relevant chunks');
    const searchOptions = {
      limit: options.limit || 5,
      scoreThreshold: options.scoreThreshold || 0.7,
    };

    const results = await vectorDb.search(queryEmbedding, searchOptions);

    if (results.length === 0) {
      logger.info('No relevant documents found for query');
      return {
        success: true,
        answer: 'The requested information was not found in the available project documents.',
        sources: [],
        metadata: {
          chunksRetrieved: 0,
          durationMs: Date.now() - startTime,
        },
      };
    }

    logger.info('Retrieved chunks', { count: results.length });

    // Step 3: Build context from retrieved chunks
    logger.debug('Step 3: Building context');
    const context = buildContext(results);

    // Step 4: Generate answer using LLM
    logger.debug('Step 4: Generating answer');
    const systemPromptText = await getSystemPrompt();
    const userPrompt = buildUserPrompt(question, context);

    const llmResponse = await generateAnswerWithSystem(
      systemPromptText,
      userPrompt,
      { temperature: 0.1, maxTokens: 1000 }
    );

    // Step 5: Extract and format sources
    logger.debug('Step 5: Formatting sources');
    const sources = extractSources(results);

    const duration = Date.now() - startTime;
    logger.info('Query processed successfully', {
      durationMs: duration,
      chunksUsed: results.length,
      sourcesCount: sources.length,
    });

    return {
      success: true,
      answer: llmResponse.answer,
      sources,
      metadata: {
        chunksRetrieved: results.length,
        tokensUsed: llmResponse.usage.total_tokens,
        durationMs: duration,
      },
    };
  } catch (error) {
    logger.error('Error processing query', {
      question,
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      error: error.message,
      answer: 'An error occurred while processing your question. Please try again.',
      sources: [],
    };
  }
}

/**
 * Build context string from retrieved chunks
 */
function buildContext(results) {
  const contextParts = results.map((result, index) => {
    const metadata = result.metadata;
    let source = `[Source ${index + 1}]`;
    
    if (metadata.doc_name) {
      source += ` ${metadata.doc_name}`;
    }
    if (metadata.page) {
      source += ` (Page ${metadata.page})`;
    }
    if (metadata.section) {
      source += ` - ${metadata.section}`;
    }
    if (metadata.sheet_name) {
      source += ` - Sheet: ${metadata.sheet_name}`;
    }

    return `${source}\n${metadata.chunk_text}\n`;
  });

  return contextParts.join('\n---\n\n');
}

/**
 * Build user prompt with question and context
 */
function buildUserPrompt(question, context) {
  return `Based on the following document excerpts, answer the question. Only use information from these excerpts. If the information is not present, say so.

DOCUMENT EXCERPTS:
${context}

QUESTION:
${question}

ANSWER:`;
}

/**
 * Extract and format sources from search results
 */
function extractSources(results) {
  const sources = [];
  const seenDocs = new Set();

  for (const result of results) {
    const metadata = result.metadata;
    const docKey = `${metadata.doc_name}_${metadata.page || 'na'}_${metadata.section || 'na'}`;

    // Avoid duplicate sources
    if (seenDocs.has(docKey)) {
      continue;
    }
    seenDocs.add(docKey);

    const source = {
      docName: metadata.doc_name,
      docType: metadata.doc_type,
      relevanceScore: result.score,
    };

    // Add document-specific metadata
    if (metadata.page) {
      source.page = metadata.page;
    }
    if (metadata.section) {
      source.section = metadata.section;
    }
    if (metadata.sheet_name) {
      source.sheetName = metadata.sheet_name;
    }
    if (metadata.row_number) {
      source.rowNumber = metadata.row_number;
    }

    sources.push(source);
  }

  return sources;
}

export default {
  processQuery,
};
