/**
 * Deterministic Value Extraction
 * 
 * Extracts exact numeric values from retrieved context to prevent LLM rounding/approximation.
 * For questions requiring precise numeric answers (ratios, voltages, capacities, etc.),
 * this extracts the exact value as it appears in the source documents.
 * 
 * RULES:
 * - Only extract values that appear in retrieved context
 * - Preserve precision exactly as in source (no rounding)
 * - Normalize only punctuation (comma → dot for decimals)
 * - Support various decimal formats (1,424 or 1.424)
 */

import { logger } from '../../utils/logger.js';

/**
 * Extract deterministic values from context for specific question types
 * @param {string} question - The user's question
 * @param {Array} chunks - Retrieved context chunks
 * @returns {object} - Extracted values with metadata
 */
export function extractDeterministicValues(question, chunks) {
  const questionLower = question.toLowerCase();
  
  // Detect question intent
  const intent = detectValueExtractionIntent(questionLower);
  
  if (!intent.requiresExtraction) {
    return { extracted: false };
  }
  
  logger.info('[ValueExtractor] Deterministic extraction triggered', {
    intent: intent.type,
    keywords: intent.keywords,
  });
  
  // Extract based on intent type
  let extraction = null;
  
  switch (intent.type) {
    case 'dc_ac_ratio':
      extraction = extractDCACRatio(questionLower, chunks, intent.keywords);
      break;
    case 'voltage':
      extraction = extractVoltage(questionLower, chunks, intent.keywords);
      break;
    case 'capacity':
      extraction = extractCapacity(questionLower, chunks, intent.keywords);
      break;
    case 'temperature':
      extraction = extractTemperature(questionLower, chunks, intent.keywords);
      break;
    default:
      extraction = extractGenericNumeric(questionLower, chunks, intent.keywords);
  }
  
  if (extraction && extraction.value) {
    logger.info('[ValueExtractor] Value extracted successfully', {
      type: intent.type,
      value: extraction.value,
      sourceChunk: extraction.chunkIndex,
      sourceDoc: extraction.docName,
      substring: extraction.matchedText,
    });
  }
  
  return extraction || { extracted: false };
}

/**
 * Detect if question requires deterministic value extraction
 */
function detectValueExtractionIntent(questionLower) {
  // DC/AC Ratio questions
  if (questionLower.includes('dc/ac') || questionLower.includes('dc ac ratio')) {
    return {
      requiresExtraction: true,
      type: 'dc_ac_ratio',
      keywords: ['dc/ac', 'ratio', '@', 'dc ac', 'dc-ac'],
    };
  }
  
  // Voltage questions
  if (questionLower.match(/voltage|kv|volt/i)) {
    return {
      requiresExtraction: true,
      type: 'voltage',
      keywords: ['voltage', 'kv', 'volt', 'v'],
    };
  }
  
  // Capacity questions
  if (questionLower.match(/capacity|kwp|mwp/i)) {
    return {
      requiresExtraction: true,
      type: 'capacity',
      keywords: ['capacity', 'kwp', 'mwp', 'kw', 'mw'],
    };
  }
  
  // Temperature questions
  if (questionLower.match(/temperature|°c|celsius/i)) {
    return {
      requiresExtraction: true,
      type: 'temperature',
      keywords: ['temperature', '°c', 'celsius', 'ambient'],
    };
  }
  
  return { requiresExtraction: false };
}

/**
 * Extract DC/AC ratio from context
 * Handles formats like:
 * - "DC/AC Ratio (@40ºC) 1,424"
 * - "DC/AC ratio: 1.291 @30°C"
 * - "ratio of 1,424 at 40°C"
 */
function extractDCACRatio(questionLower, chunks, keywords) {
  // Extract substation number if mentioned
  const substationMatch = questionLower.match(/substation\s*(\d+)/i);
  const substationNum = substationMatch ? substationMatch[1] : null;
  
  // Build search patterns for DC/AC ratio
  const patterns = [
    // Pattern 1: "DC/AC Ratio (@40ºC) 1,424" or "DC/AC Ratio (@40°C) 1.424"
    /dc[\s\/-]*ac\s*ratio\s*\(@?\s*(\d+)\s*[°º]?c?\)?\s*[:\s]*([0-9]+[,.]?\d{0,3})/gi,
    // Pattern 2: "ratio: 1.291 @30°C" or "ratio (@30°C): 1.291"
    /ratio\s*\(@?\s*(\d+)\s*[°º]?c?\)?\s*[:\s]*([0-9]+[,.]?\d{0,3})/gi,
    // Pattern 3: "DC/AC Ratio 1,424 @40°C"
    /dc[\s\/-]*ac\s*ratio\s*[:\s]*([0-9]+[,.]?\d{0,3})\s*@?\s*(\d+)\s*[°º]?c?/gi,
  ];
  
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const text = chunk.chunk_text || '';
    const textLower = text.toLowerCase();
    
    // Skip if substation specified but doesn't match
    if (substationNum && !textLower.includes(`substation ${substationNum}`) && 
        !textLower.includes(`substation${substationNum}`) &&
        !textLower.includes(`sub${substationNum}`) &&
        !textLower.includes(`ss${substationNum}`)) {
      continue;
    }
    
    // Try each pattern
    for (const pattern of patterns) {
      pattern.lastIndex = 0; // Reset regex
      const matches = [...text.matchAll(pattern)];
      
      for (const match of matches) {
        let value, temperature;
        
        // Determine which capture group has the ratio value vs temperature
        if (match[1] && match[2]) {
          // Check which is the temperature (2 digits) vs ratio (decimal)
          const first = match[1].replace(/[,\s]/g, '');
          const second = match[2].replace(/[,\s]/g, '');
          
          if (parseFloat(first) > 20 && parseFloat(second) < 20) {
            // First is temperature, second is ratio
            temperature = first;
            value = second;
          } else if (parseFloat(second) > 20 && parseFloat(first) < 20) {
            // Second is temperature, first is ratio
            temperature = second;
            value = first;
          } else {
            // Default: first is ratio, second is temperature
            value = first;
            temperature = second;
          }
        } else {
          continue;
        }
        
        // Normalize comma to dot for decimal (European format: 1,424 → 1.424)
        const normalizedValue = value.replace(',', '.');
        
        // Validate it's a reasonable ratio (between 0.5 and 3.0)
        const numericValue = parseFloat(normalizedValue);
        if (isNaN(numericValue) || numericValue < 0.5 || numericValue > 3.0) {
          continue;
        }
        
        // Check temperature matches question if specified
        const questionTempMatch = questionLower.match(/@?\s*(\d+)\s*[°º]?c/);
        if (questionTempMatch) {
          const questionTemp = questionTempMatch[1];
          if (temperature !== questionTemp) {
            continue; // Temperature doesn't match
          }
        }
        
        return {
          extracted: true,
          type: 'dc_ac_ratio',
          value: normalizedValue,
          unit: `@${temperature}°C`,
          chunkIndex,
          docName: chunk.doc_name || 'Unknown',
          section: chunk.section_title || chunk.section || 'Unknown',
          matchedText: match[0],
          confidence: 'high',
        };
      }
    }
  }
  
  return { extracted: false };
}

/**
 * Extract voltage from context
 */
function extractVoltage(questionLower, chunks, keywords) {
  // Patterns for voltage extraction
  const patterns = [
    // "1500 V", "1500V", "1.5 kV"
    /(\d+(?:[,.]\d+)?)\s*(kV|V|volt)/gi,
    // "voltage: 33 kV", "voltage level: 1500V"
    /voltage[:\s]+(\d+(?:[,.]\d+)?)\s*(kV|V)/gi,
  ];
  
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const text = chunk.chunk_text || '';
    
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const matches = [...text.matchAll(pattern)];
      
      for (const match of matches) {
        const value = match[1].replace(',', '.');
        const unit = match[2];
        
        return {
          extracted: true,
          type: 'voltage',
          value,
          unit,
          chunkIndex,
          docName: chunk.doc_name || 'Unknown',
          section: chunk.section_title || chunk.section || 'Unknown',
          matchedText: match[0],
          confidence: 'high',
        };
      }
    }
  }
  
  return { extracted: false };
}

/**
 * Extract capacity from context
 */
function extractCapacity(questionLower, chunks, keywords) {
  const patterns = [
    /(\d+(?:[,.]\d+)?)\s*(MWp|kWp|MW|kW)/gi,
    /capacity[:\s]+(\d+(?:[,.]\d+)?)\s*(MWp|kWp|MW|kW)/gi,
  ];
  
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const text = chunk.chunk_text || '';
    
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const matches = [...text.matchAll(pattern)];
      
      for (const match of matches) {
        const value = match[1].replace(',', '.');
        const unit = match[2];
        
        return {
          extracted: true,
          type: 'capacity',
          value,
          unit,
          chunkIndex,
          docName: chunk.doc_name || 'Unknown',
          section: chunk.section_title || chunk.section || 'Unknown',
          matchedText: match[0],
          confidence: 'high',
        };
      }
    }
  }
  
  return { extracted: false };
}

/**
 * Extract temperature from context
 */
function extractTemperature(questionLower, chunks, keywords) {
  const patterns = [
    /(-?\d+(?:[,.]\d+)?)\s*[°º]C/gi,
    /(-?\d+(?:[,.]\d+)?)\s*celsius/gi,
    /temperature[:\s]+(-?\d+(?:[,.]\d+)?)\s*[°º]?C/gi,
  ];
  
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const text = chunk.chunk_text || '';
    
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const matches = [...text.matchAll(pattern)];
      
      for (const match of matches) {
        const value = match[1].replace(',', '.');
        
        return {
          extracted: true,
          type: 'temperature',
          value,
          unit: '°C',
          chunkIndex,
          docName: chunk.doc_name || 'Unknown',
          section: chunk.section_title || chunk.section || 'Unknown',
          matchedText: match[0],
          confidence: 'high',
        };
      }
    }
  }
  
  return { extracted: false };
}

/**
 * Extract generic numeric value from context
 */
function extractGenericNumeric(questionLower, chunks, keywords) {
  // For now, return false to let LLM handle
  return { extracted: false };
}

/**
 * Format extracted value for injection into LLM prompt
 */
export function formatExtractedValue(extraction) {
  if (!extraction.extracted) {
    return null;
  }
  
  return `EXTRACTED VALUE: ${extraction.value} ${extraction.unit || ''} (from ${extraction.docName}, ${extraction.section})`;
}
