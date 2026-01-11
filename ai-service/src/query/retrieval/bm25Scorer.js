import logger from '../../utils/logger.js';

/**
 * BM25 Scoring Module
 * Implements BM25 algorithm for keyword-based retrieval
 * NO API calls - pure lexical matching
 */

// BM25 hyperparameters
const K1 = 1.5; // Term frequency saturation parameter
const B = 0.75; // Length normalization parameter

/**
 * Tokenize text into terms (words)
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  
  // Convert to lowercase, split on non-alphanumeric, filter empty
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 0);
}

/**
 * Calculate term frequency (TF) for a term in a document
 */
function termFrequency(term, tokens) {
  let count = 0;
  for (const token of tokens) {
    if (token === term) {
      count++;
    }
  }
  return count;
}

/**
 * Calculate inverse document frequency (IDF) for a term
 */
function inverseDocumentFrequency(term, allDocTokens) {
  const N = allDocTokens.length;
  let documentsWithTerm = 0;
  
  for (const docTokens of allDocTokens) {
    if (docTokens.includes(term)) {
      documentsWithTerm++;
    }
  }
  
  // Avoid division by zero
  if (documentsWithTerm === 0) {
    return 0;
  }
  
  // IDF formula: log((N - n + 0.5) / (n + 0.5))
  return Math.log((N - documentsWithTerm + 0.5) / (documentsWithTerm + 0.5));
}

/**
 * Calculate BM25 score for a document given a query
 */
function calculateBM25Score(queryTokens, docTokens, avgDocLength, allDocTokens) {
  const docLength = docTokens.length;
  let score = 0;
  
  // For each unique query term
  const uniqueQueryTerms = [...new Set(queryTokens)];
  
  for (const term of uniqueQueryTerms) {
    const tf = termFrequency(term, docTokens);
    
    // Skip if term not in document
    if (tf === 0) {
      continue;
    }
    
    const idf = inverseDocumentFrequency(term, allDocTokens);
    
    // BM25 formula
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (docLength / avgDocLength));
    
    score += idf * (numerator / denominator);
  }
  
  return score;
}

/**
 * Score all chunks using BM25
 * @param {string} query - The search query
 * @param {Array} chunks - Array of chunks with {chunk_text, section_title, ...}
 * @param {Object} options - Scoring options
 * @returns {Array} - Scored chunks sorted by relevance
 */
export function scoreBM25(query, chunks, options = {}) {
  const {
    limit = 10,
    minScore = 0,
    sectionTitleBoost = 2.0, // Boost score if term found in section title
  } = options;
  
  if (!chunks || chunks.length === 0) {
    logger.warn('No chunks to score');
    return [];
  }
  
  logger.debug('BM25 scoring started', {
    query,
    chunkCount: chunks.length,
    limit,
  });
  
  // Tokenize query
  const queryTokens = tokenize(query);
  
  if (queryTokens.length === 0) {
    logger.warn('Query produced no tokens after tokenization');
    return [];
  }
  
  logger.debug('Query tokenized', {
    tokens: queryTokens,
    tokenCount: queryTokens.length,
  });
  
  // Tokenize all documents (chunk_text + section_title)
  const allDocTokens = chunks.map(chunk => {
    const chunkText = chunk.chunk_text || '';
    const sectionTitle = chunk.section_title || chunk.section || '';
    
    // Combine text and title for tokenization
    const combinedText = `${chunkText} ${sectionTitle}`;
    return tokenize(combinedText);
  });
  
  // Calculate average document length
  const totalTokens = allDocTokens.reduce((sum, tokens) => sum + tokens.length, 0);
  const avgDocLength = totalTokens / allDocTokens.length;
  
  logger.debug('Document statistics', {
    totalDocs: allDocTokens.length,
    avgDocLength: avgDocLength.toFixed(2),
  });
  
  // Score each chunk
  const scoredChunks = chunks.map((chunk, index) => {
    const docTokens = allDocTokens[index];
    
    // Calculate base BM25 score
    let score = calculateBM25Score(queryTokens, docTokens, avgDocLength, allDocTokens);
    
    // Apply section title boost
    // If query terms appear in section title, boost the score
    if (sectionTitleBoost > 1.0) {
      const sectionTitle = chunk.section_title || chunk.section || '';
      const sectionTokens = tokenize(sectionTitle);
      
      let titleMatchCount = 0;
      for (const queryToken of queryTokens) {
        if (sectionTokens.includes(queryToken)) {
          titleMatchCount++;
        }
      }
      
      if (titleMatchCount > 0) {
        const titleBoostMultiplier = 1 + (titleMatchCount / queryTokens.length) * (sectionTitleBoost - 1);
        score *= titleBoostMultiplier;
        
        logger.debug('Section title boost applied', {
          chunkId: chunk.doc_id,
          section: sectionTitle,
          matchCount: titleMatchCount,
          multiplier: titleBoostMultiplier.toFixed(2),
        });
      }
    }
    
    return {
      chunk,
      score,
      index,
    };
  });
  
  // Sort by score (descending) - don't filter by minScore initially to see all scores
  const sorted = scoredChunks.sort((a, b) => b.score - a.score);
  
  // Log ALL scores for debugging
  logger.info('BM25 scoring complete - ALL SCORES', {
    totalChunks: chunks.length,
    scores: sorted.slice(0, 10).map(s => s.score.toFixed(4)),
    topSections: sorted.slice(0, 5).map(s => s.chunk.section_title || s.chunk.section || 'N/A'),
  });
  
  // Filter by minimum score
  const filtered = sorted.filter(item => item.score > minScore);
  
  logger.info('BM25 scoring filtered', {
    totalChunks: chunks.length,
    scoredAboveMin: filtered.length,
    minScore,
    returningTop: Math.min(limit, filtered.length),
  });
  
  // If no results above minScore, return top results anyway (sorted by score)
  if (filtered.length === 0) {
    logger.warn('No results above minScore, returning top results anyway');
    const topResults = sorted.slice(0, limit);
    
    logger.info('Returning top results despite low scores', {
      count: topResults.length,
      scores: topResults.map(r => r.score.toFixed(4)),
      sections: topResults.map(r => r.chunk.section_title || r.chunk.section || 'N/A'),
    });
    
    return topResults;
  }
  
  // Log top results for debugging
  if (filtered.length > 0) {
    const topResults = filtered.slice(0, Math.min(5, filtered.length));
    logger.debug('Top BM25 results', {
      results: topResults.map(r => ({
        score: r.score.toFixed(4),
        section: r.chunk.section_title || r.chunk.section || 'N/A',
        textPreview: (r.chunk.chunk_text || '').substring(0, 100),
      })),
    });
  }
  
  // Return top N chunks
  return filtered.slice(0, limit);
}

/**
 * Simple keyword matching (fallback if BM25 produces no results)
 */
export function simpleKeywordMatch(query, chunks, options = {}) {
  const { limit = 10 } = options;
  
  const queryTokens = tokenize(query);
  
  if (queryTokens.length === 0) {
    return [];
  }
  
  // Count how many query terms appear in each chunk
  const scored = chunks.map(chunk => {
    const chunkText = chunk.chunk_text || '';
    const sectionTitle = chunk.section_title || chunk.section || '';
    const combinedText = `${chunkText} ${sectionTitle}`.toLowerCase();
    
    let matchCount = 0;
    for (const token of queryTokens) {
      if (combinedText.includes(token)) {
        matchCount++;
      }
    }
    
    return {
      chunk,
      score: matchCount,
    };
  });
  
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export default {
  scoreBM25,
  simpleKeywordMatch,
};
