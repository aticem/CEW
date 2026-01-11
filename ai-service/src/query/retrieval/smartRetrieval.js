import logger from '../../utils/logger.js';

/**
 * Smart Retrieval Strategy
 * Implements prioritized retrieval:
 * 1. Section-title match
 * 2. Table-title match
 * 3. Entity-type match
 * 4. BM25 keyword match
 * 
 * Dynamically expands retrieval window based on answer completeness
 */

/**
 * Score and rank chunks using multiple strategies
 */
export function scoreChunks(chunks, question) {
  const questionLower = question.toLowerCase();
  
  // Detect question intent
  const intent = detectQuestionIntent(questionLower);
  
  // Score each chunk
  const scoredChunks = chunks.map(chunk => {
    let score = chunk.bm25Score || 0; // Start with BM25 score
    let boosts = [];
    
    // BOOST 1: Section-title relevance (high priority)
    if (chunk.section_title) {
      const sectionLower = chunk.section_title.toLowerCase();
      if (questionLower.includes(sectionLower) || sectionLower.includes(questionLower.split(' ')[0])) {
        score += 5;
        boosts.push('section_match');
      }
    }
    
    // BOOST 2: Table chunks (critical for structured data)
    if (chunk.is_table_chunk) {
      score += 8; // Tables often contain exact answers
      boosts.push('table_chunk');
      
      // Extra boost if table title matches question
      if (chunk.table_title) {
        const tableTitleLower = chunk.table_title.toLowerCase();
        const questionWords = questionLower.split(/\s+/);
        const matchCount = questionWords.filter(w => w.length > 3 && tableTitleLower.includes(w)).length;
        if (matchCount > 0) {
          score += matchCount * 3;
          boosts.push('table_title_match');
        }
      }
    }
    
    // BOOST 3: Entity type match
    if (chunk.entity_types && intent.entityTypes.length > 0) {
      const chunkEntities = chunk.entity_types.split(',');
      const matchingEntities = intent.entityTypes.filter(et => chunkEntities.includes(et));
      if (matchingEntities.length > 0) {
        score += matchingEntities.length * 4;
        boosts.push(`entity_match:${matchingEntities.join(',')}`);
      }
    }
    
    // BOOST 4: Unit match (for numeric questions)
    if (chunk.units && intent.units.length > 0) {
      const chunkUnits = chunk.units.split(',');
      const matchingUnits = intent.units.filter(u => chunkUnits.some(cu => cu.toLowerCase() === u.toLowerCase()));
      if (matchingUnits.length > 0) {
        score += matchingUnits.length * 2;
        boosts.push(`unit_match:${matchingUnits.join(',')}`);
      }
    }
    
    // BOOST 5: Atomic chunks (complete information units)
    if (chunk.is_atomic) {
      score += 3;
      boosts.push('atomic');
    }
    
    return {
      ...chunk,
      finalScore: score,
      boosts: boosts.length > 0 ? boosts : null,
    };
  });
  
  // Sort by final score (descending)
  scoredChunks.sort((a, b) => b.finalScore - a.finalScore);
  
  logger.debug('Chunks scored and ranked', {
    totalChunks: chunks.length,
    intent,
    topScore: scoredChunks[0]?.finalScore,
    topBoosts: scoredChunks[0]?.boosts,
  });
  
  return scoredChunks;
}

/**
 * Detect question intent and extract relevant metadata
 */
function detectQuestionIntent(questionLower) {
  const intent = {
    entityTypes: [],
    units: [],
    isNumeric: false,
    isTable: false,
    isConfiguration: false,
  };
  
  // Detect entity types
  if (/\b(capacity|power|kwp|mwp|watt)\b/i.test(questionLower)) {
    intent.entityTypes.push('capacity', 'power');
    intent.units.push('kWp', 'MWp', 'kW', 'MW', 'Wp');
  }
  
  if (/\b(voltage|volt|kv|v|vdc|vac)\b/i.test(questionLower)) {
    intent.entityTypes.push('voltage');
    intent.units.push('kV', 'V', 'VDC', 'VAC');
  }
  
  if (/\b(temperature|temp|°c|celsius)\b/i.test(questionLower)) {
    intent.entityTypes.push('temperature');
    intent.units.push('°C', 'celsius');
  }
  
  if (/\b(current|amp|ampere)\b/i.test(questionLower)) {
    intent.entityTypes.push('current');
    intent.units.push('A', 'mA', 'Amp');
  }
  
  if (/\b(ratio|dc\/ac|dc-ac)\b/i.test(questionLower)) {
    intent.entityTypes.push('ratio');
  }
  
  if (/\b(cable|wire|conductor|mm²)\b/i.test(questionLower)) {
    intent.entityTypes.push('cable');
    intent.units.push('mm²');
  }
  
  if (/\b(string|module|inverter|substation)\b/i.test(questionLower)) {
    intent.entityTypes.push('configuration');
    intent.isConfiguration = true;
  }
  
  // Detect numeric/table questions
  if (/\b(how many|how much|what is the|total|number)\b/i.test(questionLower)) {
    intent.isNumeric = true;
    intent.isTable = true; // Numeric data often in tables
  }
  
  return intent;
}

/**
 * Dynamic retrieval window expansion
 * If initial results seem incomplete, fetch more chunks
 */
export function shouldExpandRetrieval(chunks, question, currentLimit) {
  // If we have very few results, expand
  if (chunks.length < 3) {
    return { expand: true, newLimit: currentLimit * 2 };
  }
  
  // If top chunks have low scores, expand
  const avgTopScore = chunks.slice(0, 3).reduce((sum, c) => sum + c.finalScore, 0) / 3;
  if (avgTopScore < 5) {
    return { expand: true, newLimit: currentLimit * 1.5 };
  }
  
  // If question asks for multiple items but we have few table chunks
  const questionWantsMultiple = /\b(how many|list|all|total|each)\b/i.test(question);
  const tableChunkCount = chunks.filter(c => c.is_table_chunk).length;
  
  if (questionWantsMultiple && tableChunkCount < 2) {
    return { expand: true, newLimit: currentLimit * 1.5 };
  }
  
  return { expand: false };
}

/**
 * Group related chunks for better context
 * Ensures tables and their surrounding content are kept together
 */
export function groupRelatedChunks(chunks) {
  const groups = [];
  const processed = new Set();
  
  for (let i = 0; i < chunks.length; i++) {
    if (processed.has(i)) continue;
    
    const chunk = chunks[i];
    const group = [chunk];
    processed.add(i);
    
    // If this is a table, look for related context chunks
    if (chunk.is_table_chunk && chunk.section_path) {
      for (let j = 0; j < chunks.length; j++) {
        if (i === j || processed.has(j)) continue;
        
        const otherChunk = chunks[j];
        
        // Group chunks from same section
        if (otherChunk.section_path === chunk.section_path) {
          group.push(otherChunk);
          processed.add(j);
        }
      }
    }
    
    groups.push(group);
  }
  
  logger.debug('Chunks grouped', {
    originalCount: chunks.length,
    groupCount: groups.length,
  });
  
  return groups;
}

export default {
  scoreChunks,
  detectQuestionIntent,
  shouldExpandRetrieval,
  groupRelatedChunks,
};
