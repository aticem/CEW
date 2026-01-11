import mammoth from 'mammoth';
import logger from '../../utils/logger.js';

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

    // Parse HTML to extract structured content
    const structure = parseHTMLStructure(htmlResult.value);

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
      tables: structure.filter(s => s.type === 'table_cell').length,
    });

    return {
      type: 'WORD_DOC',
      status: 'SUCCESS',
      text: fullText,
      structure,
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
 */
function parseHTMLStructure(html) {
  const structure = [];
  let currentSection = null;
  let sectionHierarchy = [];

  // Remove line breaks within tags to make parsing easier
  const normalizedHtml = html.replace(/\n\s*/g, ' ');

  // Extract all HTML tags with their content
  const tagRegex = /<(h[1-6]|p|li|td|th|tr|table)(?:\s[^>]*)?>(.+?)<\/\1>/gi;
  let match;

  while ((match = tagRegex.exec(normalizedHtml)) !== null) {
    const tagName = match[1].toLowerCase();
    const content = match[2];
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
    // Handle table cells
    else if (tagName === 'td' || tagName === 'th') {
      structure.push({
        type: 'table_cell',
        text,
        section: currentSection || 'Document',
        sectionPath: sectionHierarchy.join(' > ') || 'Document',
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
