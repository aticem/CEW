import mammoth from 'mammoth';
import logger from '../../utils/logger.js';
import { extractTablesFromHTML, findTableTitle, tableToText, detectTableEntityTypes, detectTableUnits } from './tableExtractor.js';

/**
 * Parse Word document (.docx, .doc) with FULL STRUCTURE PRESERVATION
 * Extracts headings, paragraphs, lists, and tables
 */
export async function parseWordDocument(buffer, metadata) {
  try {
    logger.info('Parsing Word document with structure extraction', { docName: metadata.doc_name });

    // Use HTML conversion to preserve structure (headings, lists, tables)
    const htmlResult = await mammoth.convertToHtml({ buffer });

    if (!htmlResult.value || htmlResult.value.trim().length === 0) {
      logger.warn('No content extracted from Word document', { docName: metadata.doc_name });
      return {
        type: 'WORD_DOC',
        status: 'EMPTY',
        text: '',
        structure: [],
        wordCount: 0,
      };
    }

    // Extract tables FIRST (atomic units)
    const tables = extractTablesFromHTML(htmlResult.value);
    
    // Parse HTML to extract structured content (excluding tables for now)
    const structure = parseHTMLStructure(htmlResult.value, tables);

    // Calculate word count
    const fullText = structure.map(item => item.text).join(' ');
    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

    logger.info('Word document parsed with structure', {
      docName: metadata.doc_name,
      elements: structure.length,
      wordCount,
      headings: structure.filter(s => s.type.startsWith('heading')).length,
      paragraphs: structure.filter(s => s.type === 'paragraph').length,
      lists: structure.filter(s => s.type === 'list_item').length,
      tables: structure.filter(s => s.type === 'table').length,
      atomicTables: tables.length,
    });

    return {
      type: 'WORD_DOC',
      status: 'SUCCESS',
      text: fullText,
      structure,
      tables, // Atomic tables
      wordCount,
      messages: htmlResult.messages || [],
    };
  } catch (error) {
    logger.error('Error parsing Word document', {
      docName: metadata.doc_name,
      error: error.message,
      stack: error.stack,
    });

    return {
      type: 'WORD_DOC',
      status: 'ERROR',
      error: error.message,
      text: '',
      structure: [],
      wordCount: 0,
    };
  }
}

/**
 * Parse HTML structure to extract semantic elements
 * Handles multi-line HTML and nested tags from mammoth
 * Tables are extracted separately and inserted as atomic units
 */
function parseHTMLStructure(html, atomicTables = []) {
  const structure = [];
  let currentSection = null;
  let sectionHierarchy = [];
  let tableIndex = 0;

  // Remove tables from HTML to parse separately
  let htmlWithoutTables = html.replace(/<table[^>]*>.*?<\/table>/gis, `__TABLE_PLACEHOLDER_${tableIndex++}__`);

  // Remove line breaks within tags to make parsing easier
  const normalizedHtml = htmlWithoutTables.replace(/\n\s*/g, ' ');

  // Extract all HTML tags with their content
  const tagRegex = /<(h[1-6]|p|li)(?:\s[^>]*)?>(.+?)<\/\1>/gi;
  let match;
  tableIndex = 0;

  while ((match = tagRegex.exec(normalizedHtml)) !== null) {
    const tagName = match[1].toLowerCase();
    const content = match[2];
    
    // Check if this content contains a table placeholder
    const tablePlaceholderMatch = content.match(/__TABLE_PLACEHOLDER_(\d+)__/);
    if (tablePlaceholderMatch) {
      const placeholderIndex = parseInt(tablePlaceholderMatch[1]);
      if (atomicTables[placeholderIndex]) {
        const table = atomicTables[placeholderIndex];
        const tableTitle = findTableTitle(html, table.originalHTML) || `Table ${placeholderIndex + 1}`;
        const tableText = tableToText(table, tableTitle);
        
        // Detect semantic metadata
        const entityTypes = detectTableEntityTypes(table, tableTitle);
        const units = detectTableUnits(table, tableTitle);
        
        structure.push({
          type: 'table',
          text: tableText,
          section: currentSection || 'Document',
          sectionPath: sectionHierarchy.join(' > ') || 'Document',
          tableTitle,
          tableIndex: placeholderIndex,
          headers: table.headers,
          rows: table.rows,
          rowCount: table.rowCount,
          columnCount: table.columnCount,
          entityTypes,
          units,
          isAtomic: true, // CRITICAL: Never split this chunk
        });
      }
      continue;
    }
    
    const text = stripHtmlTags(content).trim();
    if (!text || text.length === 0) continue;

    // Handle headings
    if (tagName.startsWith('h')) {
      const level = parseInt(tagName.charAt(1));
      
      // Update section hierarchy
      sectionHierarchy = sectionHierarchy.slice(0, level - 1);
      sectionHierarchy[level - 1] = text;
      
      structure.push({
        type: `heading${level}`,
        level,
        text,
        section: sectionHierarchy.slice(0, level).join(' > '),
      });
      
      currentSection = text;
    }
    // Handle paragraphs
    else if (tagName === 'p') {
      structure.push({
        type: 'paragraph',
        text,
        section: currentSection || 'Document',
        sectionPath: sectionHierarchy.join(' > ') || 'Document',
      });
    }
    // Handle list items
    else if (tagName === 'li') {
      structure.push({
        type: 'list_item',
        text,
        section: currentSection || 'Document',
        sectionPath: sectionHierarchy.join(' > ') || 'Document',
      });
    }
  }

  // Insert any remaining tables that weren't caught in the first pass
  for (let i = 0; i < atomicTables.length; i++) {
    // Check if table is already in structure
    const alreadyAdded = structure.some(s => s.type === 'table' && s.tableIndex === i);
    if (!alreadyAdded) {
      const table = atomicTables[i];
      const tableTitle = `Table ${i + 1}`;
      const tableText = tableToText(table, tableTitle);
      const entityTypes = detectTableEntityTypes(table, tableTitle);
      const units = detectTableUnits(table, tableTitle);
      
      structure.push({
        type: 'table',
        text: tableText,
        section: currentSection || 'Document',
        sectionPath: sectionHierarchy.join(' > ') || 'Document',
        tableTitle,
        tableIndex: i,
        headers: table.headers,
        rows: table.rows,
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        entityTypes,
        units,
        isAtomic: true,
      });
    }
  }

  // If no structured elements found, fall back to paragraph extraction
  if (structure.length === 0) {
    logger.warn('No structured HTML elements found, falling back to paragraph extraction');
    const paragraphs = html.split(/<\/?p>/gi)
      .map(p => stripHtmlTags(p).trim())
      .filter(p => p.length > 0);
    
    paragraphs.forEach(text => {
      structure.push({
        type: 'paragraph',
        text,
        section: 'Document',
        sectionPath: 'Document',
      });
    });
  }

  return structure;
}

/**
 * Strip HTML tags from text
 */
function stripHtmlTags(html) {
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

/**
 * Build hierarchical document tree from structure
 * Groups content under section headings
 */
export function buildDocumentTree(structure) {
  const tree = {
    section: 'Document Root',
    level: 0,
    children: [],
    content: [],
  };

  let currentPath = [tree];

  for (const element of structure) {
    if (element.type.startsWith('heading')) {
      const level = element.level;

      // Navigate to correct level in tree
      while (currentPath.length > level) {
        currentPath.pop();
      }

      // Create new section node
      const sectionNode = {
        section: element.text,
        level,
        children: [],
        content: [],
      };

      currentPath[currentPath.length - 1].children.push(sectionNode);
      currentPath.push(sectionNode);
    } else {
      // Add content to current section
      currentPath[currentPath.length - 1].content.push(element);
    }
  }

  return tree;
}

/**
 * Extract sections with full context
 * Returns flat list of sections with their content
 */
export function extractSections(documentTree) {
  const sections = [];

  function traverse(node, parentPath = []) {
    const currentPath = [...parentPath, node.section];
    const sectionPath = currentPath.join(' > ');

    if (node.content.length > 0) {
      sections.push({
        section: node.section,
        sectionPath,
        level: node.level,
        content: node.content,
        text: node.content.map(c => c.text).join('\n'),
      });
    }

    for (const child of node.children) {
      traverse(child, currentPath);
    }
  }

  traverse(documentTree, []);
  return sections;
}

export default {
  parseWordDocument,
  buildDocumentTree,
  extractSections,
};
