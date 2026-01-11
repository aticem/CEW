import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { generateEmbedding } from '../ingest/embeddings/embeddingService.js';
import * as vectorDb from '../vector/vectorDbClient.js';
import { generateAnswerWithSystem } from './llm/llmService.js';
import { normalizeAnswer } from './normalization/answerNormalizer.js';
import { scoreChunks, shouldExpandRetrieval } from './retrieval/smartRetrieval.js';
import { extractDeterministicValues, formatExtractedValue } from './extraction/valueExtractor.js';

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

    // Step 1: Retrieve relevant chunks using BM25 keyword search (API-free)
    logger.info('Step 1: Retrieving chunks using BM25 keyword search (API-free)');
    
    const results = await vectorDb.searchKeywordBM25(question, {
      limit: options.limit || 20, // Retrieve top 20 for maximum coverage and cross-referencing
      minScore: 0, // No minimum score - let BM25 rank naturally
    });

    if (results.length === 0) {
      logger.info('No relevant documents found for query');
      return {
        success: true,
        answer: 'The requested information was not found in the available project documents.',
        sources: [],
        metadata: {
          chunksRetrieved: 0,
          durationMs: Date.now() - startTime,
          retrievalMethod: 'BM25_KEYWORD',
        },
      };
    }

    logger.info('Retrieved chunks via BM25', { 
      count: results.length,
      sections: results.map(r => r.metadata.section_title || r.metadata.section || 'N/A').slice(0, 5),
    });

    // Step 2: Apply smart retrieval scoring (section, table, entity boosting)
    logger.info('Step 2: Applying smart retrieval scoring');
    const chunks = results.map(r => ({ ...r.metadata, bm25Score: r.score }));
    const scoredChunks = scoreChunks(chunks, question);
    
    // Take top N chunks after re-ranking
    const topChunks = scoredChunks.slice(0, 25); // Increased to 25 for better coverage
    
    logger.info('Smart retrieval complete', {
      chunksReranked: scoredChunks.length,
      topChunksUsed: topChunks.length,
      tableChunks: topChunks.filter(c => c.is_table_chunk).length,
      avgScore: (topChunks.reduce((sum, c) => sum + c.finalScore, 0) / topChunks.length).toFixed(2),
    });

    // Step 3: Extract deterministic values (ratios, voltages, etc.)
    logger.debug('Step 3: Extracting deterministic values');
    const extractedValue = extractDeterministicValues(question, topChunks);

    // Step 4: Build context from top-scored chunks
    logger.debug('Step 4: Building context');
    const context = buildContext(topChunks);

    // Step 5: Generate answer using LLM
    logger.debug('Step 5: Generating answer');
    const systemPromptText = await getSystemPrompt();
    const userPrompt = buildUserPrompt(question, context, extractedValue);

    const llmResponse = await generateAnswerWithSystem(
      systemPromptText,
      userPrompt,
      { temperature: 0.0, maxTokens: 1200 } // Lower temperature for more deterministic, increased tokens for detailed answers
    );

    // Step 6: Normalize answer for better unit handling
    logger.debug('Step 6: Normalizing answer');
    const normalizedAnswer = normalizeAnswer(llmResponse.answer, question, extractedValue);

    // Step 7: Extract and format sources
    logger.debug('Step 7: Formatting sources');
    const sources = extractSources(topChunks);

    const duration = Date.now() - startTime;
    logger.info('Query processed successfully', {
      durationMs: duration,
      chunksUsed: results.length,
      sourcesCount: sources.length,
    });

    return {
      success: true,
      answer: normalizedAnswer,
      sources,
      metadata: {
        chunksRetrieved: topChunks.length,
        tableChunksUsed: topChunks.filter(c => c.is_table_chunk).length,
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
function buildContext(chunks) {
  const contextParts = chunks.map((chunk, index) => {
    let source = `[Source ${index + 1}]`;
    
    if (chunk.doc_name) {
      source += ` ${chunk.doc_name}`;
    }
    if (chunk.page) {
      source += ` (Page ${chunk.page})`;
    }
    // Use section_title (new field from ingestion improvements) or fallback to section
    if (chunk.section_title) {
      source += ` - ${chunk.section_title}`;
    } else if (chunk.section) {
      source += ` - ${chunk.section}`;
    }
    if (chunk.sheet_name) {
      source += ` - Sheet: ${chunk.sheet_name}`;
    }
    // Add table title if it's a table chunk
    if (chunk.is_table_chunk && chunk.table_title) {
      source += ` [${chunk.table_title}]`;
    }

    // Debug log each chunk being used
    logger.debug('Context chunk', {
      index: index + 1,
      finalScore: chunk.finalScore?.toFixed(2),
      bm25Score: chunk.bm25Score?.toFixed(4),
      boosts: chunk.boosts,
      isTable: chunk.is_table_chunk,
      section: chunk.section_title || chunk.section || 'N/A',
      docName: chunk.doc_name,
      textPreview: chunk.chunk_text?.substring(0, 100),
    });

    return `${source}\n${chunk.chunk_text}\n`;
  });

  return contextParts.join('\n---\n\n');
}

/**
 * Build user prompt with question and context
 */
function buildUserPrompt(question, context, extractedValue = null) {
  let prompt = `Based on the following document excerpts, answer the question. Only use information from these excerpts. If the information is not present, say so.

DOCUMENT EXCERPTS:
${context}`;

  // Add deterministic extracted value if available
  if (extractedValue && extractedValue.extracted) {
    const valueStr = formatExtractedValue(extractedValue);
    prompt += `\n\n${valueStr}\nIMPORTANT: Use this exact value in your answer - do not round or approximate it.`;
  }

  prompt += `\n\nQUESTION:
${question}

ANSWER:`;

  return prompt;
}

/**
 * Extract and format sources from search results
 */
function extractSources(chunks) {
  const sources = [];
  const seenDocs = new Set();

  for (const chunk of chunks) {
    const docKey = `${chunk.doc_name}_${chunk.page || 'na'}_${chunk.section || 'na'}`;

    // Avoid duplicate sources
    if (seenDocs.has(docKey)) {
      continue;
    }
    seenDocs.add(docKey);

    const source = {
      docName: chunk.doc_name,
      docType: chunk.doc_type,
      relevanceScore: chunk.finalScore || chunk.bm25Score,
    };

    // Add document-specific metadata
    if (chunk.page) {
      source.page = chunk.page;
    }
    if (chunk.section) {
      source.section = chunk.section;
    }
    if (chunk.sheet_name) {
      source.sheetName = chunk.sheet_name;
    }
    if (chunk.row_number) {
      source.rowNumber = chunk.row_number;
    }

    sources.push(source);
  }

  return sources;
}

export default {
  processQuery,
};
