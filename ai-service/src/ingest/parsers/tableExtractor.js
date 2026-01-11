import logger from '../../utils/logger.js';

/**
 * Table Extraction Module
 * Detects and extracts complete tables from HTML with semantic preservation
 * 
 * KEY PRINCIPLE: Tables are ATOMIC - they must NEVER be split across chunks
 */

/**
 * Extract complete tables from HTML with full structure
 * Returns tables as atomic units with title, headers, and rows
 */
export function extractTablesFromHTML(html) {
  const tables = [];
  
  // Match complete table structures
  const tableRegex = /<table[^>]*>(.*?)<\/table>/gis;
  let tableMatch;
  let tableIndex = 0;
  
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const fullTableHTML = tableMatch[0]; // Full <table>...</table>
    const tableHTML = tableMatch[1]; // Content inside <table>
    const table = parseTableStructure(tableHTML, tableIndex);
    
    if (table && table.rows.length > 0) {
      table.originalHTML = fullTableHTML; // Store for title detection
      tables.push(table);
      tableIndex++;
    }
  }
  
  logger.debug('Extracted tables from HTML', {
    tablesFound: tables.length,
  });
  
  return tables;
}

/**
 * Parse table HTML into structured format
 */
function parseTableStructure(tableHTML, tableIndex) {
  const rows = [];
  let headers = [];
  
  // Extract all table rows
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
  let rowMatch;
  let rowIndex = 0;
  
  while ((rowMatch = rowRegex.exec(tableHTML)) !== null) {
    const rowHTML = rowMatch[1];
    const cells = extractCellsFromRow(rowHTML);
    
    if (cells.length > 0) {
      // First row with content is typically headers
      if (rowIndex === 0 && cells.some(c => c.isHeader)) {
        headers = cells.map(c => c.text);
      } else {
        rows.push(cells.map(c => c.text));
      }
      rowIndex++;
    }
  }
  
  // If no headers found but we have rows, use first row as headers
  if (headers.length === 0 && rows.length > 0) {
    headers = rows.shift();
  }
  
  return {
    tableIndex,
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
  };
}

/**
 * Extract cells from a table row
 */
function extractCellsFromRow(rowHTML) {
  const cells = [];
  
  // Match both <th> (header) and <td> (data) cells
  const cellRegex = /<(th|td)[^>]*>(.*?)<\/\1>/gis;
  let cellMatch;
  
  while ((cellMatch = cellRegex.exec(rowHTML)) !== null) {
    const tagName = cellMatch[1].toLowerCase();
    const cellHTML = cellMatch[2];
    const text = stripHTMLTags(cellHTML).trim();
    
    if (text.length > 0) {
      cells.push({
        text,
        isHeader: tagName === 'th',
      });
    }
  }
  
  return cells;
}

/**
 * Find table title from preceding content
 * Looks for heading or paragraph immediately before table
 */
export function findTableTitle(html, tableHTML) {
  const tablePosition = html.indexOf(tableHTML);
  if (tablePosition === -1) return null;
  
  // Get content before table (up to 500 chars)
  const precedingContent = html.substring(Math.max(0, tablePosition - 500), tablePosition);
  
  // Look for headings or "Table N:" patterns
  const titlePatterns = [
    /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i,
    /Table\s+\d+[:\-\s]+([^\n<]+)/i,
    /<p[^>]*><strong>([^<]+)<\/strong><\/p>/i,
  ];
  
  for (const pattern of titlePatterns) {
    const match = precedingContent.match(pattern);
    if (match) {
      return stripHTMLTags(match[1]).trim();
    }
  }
  
  return null;
}

/**
 * Convert table to formatted text representation
 */
export function tableToText(table, title = null) {
  const lines = [];
  
  // Add title if available
  if (title) {
    lines.push(title);
    lines.push('');
  }
  
  // Add headers
  if (table.headers && table.headers.length > 0) {
    lines.push(table.headers.join(' | '));
    lines.push(table.headers.map(h => '-'.repeat(h.length)).join('-|-'));
  }
  
  // Add rows
  for (const row of table.rows) {
    lines.push(row.join(' | '));
  }
  
  return lines.join('\n');
}

/**
 * Detect entity types in table (for semantic metadata)
 */
export function detectTableEntityTypes(table, title = '') {
  const entityTypes = new Set();
  const allText = [title, ...table.headers, ...table.rows.flat()].join(' ').toLowerCase();
  
  // Capacity/Power patterns
  if (/\b(kwp|mwp|kw|mw|capacity|power|watt)\b/i.test(allText)) {
    entityTypes.add('capacity');
    entityTypes.add('power');
  }
  
  // Voltage patterns
  if (/\b(voltage|volt|v|kv|vdc|vac)\b/i.test(allText)) {
    entityTypes.add('voltage');
  }
  
  // Temperature patterns
  if (/\b(temperature|temp|°c|celsius)\b/i.test(allText)) {
    entityTypes.add('temperature');
  }
  
  // Current patterns
  if (/\b(current|amp|ampere|a)\b/i.test(allText)) {
    entityTypes.add('current');
  }
  
  // Ratio patterns
  if (/\b(ratio|dc\/ac|dc-ac)\b/i.test(allText)) {
    entityTypes.add('ratio');
  }
  
  // Cable patterns
  if (/\b(cable|wire|conductor|mm²)\b/i.test(allText)) {
    entityTypes.add('cable');
  }
  
  // Configuration patterns
  if (/\b(string|module|inverter|substation)\b/i.test(allText)) {
    entityTypes.add('configuration');
  }
  
  return Array.from(entityTypes);
}

/**
 * Detect units in table data
 */
export function detectTableUnits(table, title = '') {
  const units = new Set();
  const allText = [title, ...table.headers, ...table.rows.flat()].join(' ');
  
  // Unit patterns
  const unitPatterns = [
    /\b(kWp|MWp|kW|MW|Wp)\b/g,
    /\b(kV|V|VDC|VAC)\b/g,
    /\b(°C|celsius)\b/gi,
    /\b(A|mA|Amp|Ampere)\b/g,
    /\b(mm²|mm2)\b/g,
    /\b(m|cm|km)\b/g,
    /\b(%|percent)\b/gi,
  ];
  
  for (const pattern of unitPatterns) {
    const matches = allText.match(pattern);
    if (matches) {
      matches.forEach(m => units.add(m));
    }
  }
  
  return Array.from(units);
}

/**
 * Strip HTML tags from text
 */
function stripHTMLTags(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export default {
  extractTablesFromHTML,
  findTableTitle,
  tableToText,
  detectTableEntityTypes,
  detectTableUnits,
};
