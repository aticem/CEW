/**
 * Answer Normalization Utilities
 * 
 * Normalizes AI answers for validation by handling:
 * - Unit equivalence (kWp ≈ MWp, V ≈ kV, °C)
 * - Numeric approximations
 * - Equivalent phrasings
 * 
 * IMPORTANT: Does NOT round or change precision of ratios (DC/AC, etc.)
 * to preserve exact values from source documents.
 */

import { logger } from '../../utils/logger.js';

/**
 * Normalize answer for validation comparison
 * @param {string} answer - The AI-generated answer
 * @param {string} question - The original question
 * @param {object} extractedValue - Deterministically extracted value (if any)
 * @returns {string} - Normalized answer
 */
export function normalizeAnswer(answer, question = '', extractedValue = null) {
  if (!answer || typeof answer !== 'string') {
    return answer;
  }

  let normalized = answer;

  // 0. Apply deterministic value if extracted
  if (extractedValue && extractedValue.extracted) {
    normalized = applyExtractedValue(normalized, extractedValue, question);
  }

  // 1. Normalize power units (kWp ≈ MWp)
  normalized = normalizePowerUnits(normalized);

  // 2. Normalize voltage units (V ≈ kV)
  normalized = normalizeVoltageUnits(normalized);

  // 3. Normalize temperature units (already consistent)
  normalized = normalizeTemperatureUnits(normalized);

  // 4. Normalize numeric formatting (commas, spaces)
  // NOTE: Do NOT normalize ratios - preserve precision
  normalized = normalizeNumericFormatting(normalized, question);

  logger.debug('[Normalizer] Answer normalized', {
    original: answer.substring(0, 100),
    normalized: normalized.substring(0, 100),
    hadExtractedValue: !!extractedValue?.extracted,
  });

  return normalized;
}

/**
 * Apply deterministically extracted value to answer
 * Ensures exact value from document is used in final answer
 */
function applyExtractedValue(answer, extraction, question) {
  const { type, value, unit } = extraction;
  
  logger.info('[Normalizer] Applying extracted value', {
    type,
    value,
    unit,
  });
  
  // For DC/AC ratio questions, ensure exact value is present
  if (type === 'dc_ac_ratio') {
    // Build the exact string that should appear
    const exactValue = `${value} ${unit}`;
    
    // Check if answer already has the correct value
    if (answer.includes(exactValue)) {
      logger.debug('[Normalizer] Answer already contains exact value');
      return answer;
    }
    
    // Replace any approximate ratio with exact one
    // Pattern: find ratio values like "1.425" or "1,425" and replace with exact
    const ratioPattern = /(\d+[,.]\d{1,3})\s*(@\d+[°º]?C)/gi;
    const replaced = answer.replace(ratioPattern, (match, ratioVal, temp) => {
      // Check if this is the ratio we're looking for (same temperature)
      if (temp.toLowerCase().includes(unit.match(/\d+/)[0])) {
        logger.info('[Normalizer] Replaced approximate ratio with exact value', {
          original: match,
          exact: exactValue,
        });
        return exactValue;
      }
      return match;
    });
    
    return replaced;
  }
  
  return answer;
}

/**
 * Normalize power units (kWp ↔ MWp)
 * Examples:
 * - "69,991.56 kWp" → also accepts "69.991 MWp" or "~70 MWp"
 * - "11,302.20 kW" → also accepts "11.302 MW"
 */
function normalizePowerUnits(text) {
  // Find all power values in MWp and convert to kWp equivalent
  // Pattern: number (with decimals) followed by MWp or MW
  const mwpPattern = /(\d+(?:[,.]\d+)?)\s*(MWp|MW)/gi;
  
  let result = text;
  const matches = [...text.matchAll(mwpPattern)];
  
  for (const match of matches) {
    const value = parseFloat(match[1].replace(',', '.'));
    const unit = match[2];
    const kwpValue = value * 1000;
    
    // Add kWp equivalent alongside MWp
    const kwpEquivalent = `${match[0]} (${kwpValue.toFixed(2)} kWp)`;
    result = result.replace(match[0], kwpEquivalent);
  }

  return result;
}

/**
 * Normalize voltage units (V ↔ kV)
 * Examples:
 * - "1500 V" → also accepts "1.5 kV"
 * - "33 kV" → also accepts "33000 V"
 */
function normalizeVoltageUnits(text) {
  // Find all voltage values in kV and convert to V equivalent
  const kvPattern = /(\d+(?:[,.]\d+)?)\s*kV/gi;
  
  let result = text;
  const matches = [...text.matchAll(kvPattern)];
  
  for (const match of matches) {
    const value = parseFloat(match[1].replace(',', '.'));
    const vValue = value * 1000;
    
    // Add V equivalent alongside kV
    const vEquivalent = `${match[0]} (${vValue} V)`;
    result = result.replace(match[0], vEquivalent);
  }

  return result;
}

/**
 * Normalize temperature units (already consistent with °C)
 */
function normalizeTemperatureUnits(text) {
  // Already using °C consistently, just ensure format
  return text.replace(/(\d+)\s*degrees?\s*C(?:elsius)?/gi, '$1°C');
}

/**
 * Normalize numeric formatting
 * - Handle commas vs periods as thousand separators
 * - Handle spaces in numbers
 * 
 * IMPORTANT: Do NOT round ratios - preserve 3+ decimal precision
 */
function normalizeNumericFormatting(text, question = '') {
  // For ratio questions, preserve exact decimal precision
  if (question && (question.toLowerCase().includes('ratio') || question.toLowerCase().includes('dc/ac'))) {
    logger.debug('[Normalizer] Ratio question detected - preserving precision');
    return text; // Do not modify ratios
  }
  
  // This is mainly for display; validation handles numeric comparison
  return text;
}

/**
 * Check if answer contains equivalent value
 * @param {string} answer - The AI answer
 * @param {string|number} expectedValue - Expected value
 * @param {object} options - Comparison options
 * @returns {boolean}
 */
export function containsEquivalentValue(answer, expectedValue, options = {}) {
  const {
    tolerance = 0.01, // 1% tolerance for numeric comparison
    ignoreCase = true,
  } = options;

  if (!answer) return false;

  const normalizedAnswer = ignoreCase ? answer.toLowerCase() : answer;
  const normalizedExpected = ignoreCase && typeof expectedValue === 'string' 
    ? expectedValue.toLowerCase() 
    : String(expectedValue).toLowerCase();

  // Direct string match
  if (normalizedAnswer.includes(normalizedExpected)) {
    return true;
  }

  // Try numeric comparison with tolerance
  if (typeof expectedValue === 'number' || !isNaN(parseFloat(expectedValue))) {
    const expected = parseFloat(expectedValue);
    
    // Extract all numbers from answer
    const numberPattern = /(\d+(?:[,.]\d+)?)/g;
    const matches = answer.match(numberPattern);
    
    if (matches) {
      for (const match of matches) {
        const value = parseFloat(match.replace(',', ''));
        const diff = Math.abs(value - expected);
        const percentDiff = diff / expected;
        
        if (percentDiff <= tolerance) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Extract units from answer
 * @param {string} answer
 * @returns {object} - Object with detected units
 */
export function extractUnits(answer) {
  const units = {
    power: null,
    voltage: null,
    temperature: null,
  };

  // Power units
  if (/kWp|kW/i.test(answer)) units.power = 'kWp';
  if (/MWp|MW/i.test(answer)) units.power = 'MWp';

  // Voltage units
  if (/\d+\s*V(?!\w)/i.test(answer)) units.voltage = 'V';
  if (/kV/i.test(answer)) units.voltage = 'kV';

  // Temperature units
  if (/°C|celsius/i.test(answer)) units.temperature = '°C';
  if (/°F|fahrenheit/i.test(answer)) units.temperature = '°F';

  return units;
}
