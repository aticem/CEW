import logger from '../../utils/logger.js';
import config from '../../config/env.js';

/**
 * Section-Aware Chunking Strategy
 * Creates semantically coherent chunks that respect document structure
 * 
 * Key principles:
 * - One concept per chunk
 * - Respect section boundaries
 * - Smaller chunks (200-300 tokens) for better retrieval
 * - Include full section context in metadata
 * - Never merge unrelated sections
 */

/**
 * Chunk structured Word document
 * Uses document tree to create section-aware chunks
 */
export function chunkStructuredDocument(structure, options = {}) {
  const {
    maxTokens = 300,  // Smaller chunks for better retrieval
    minTokens = 50,
    includeHeadings = true,
  } = options;

  const chunks = [];
  let currentSection = 'Document';
  let currentSectionPath = 'Document';
  let currentChunk = [];
  let currentTokenCount = 0;
  let chunkIndex = 0;

  for (const element of structure) {
    // Update current section when we hit a heading
    if (element.type.startsWith('heading')) {
      // Flush current chunk before starting new section
      if (currentChunk.length > 0) {
        chunks.push(createChunk(
          currentChunk,
          currentSection,
          currentSectionPath,
          chunkIndex++
        ));
        currentChunk = [];
        currentTokenCount = 0;
      }

      // Update section context
      currentSection = element.text;
      currentSectionPath = element.section || element.text;

      // Optionally include heading in chunk
      if (includeHeadings) {
        currentChunk.push(element);
        currentTokenCount = countTokens(element.text);
      }
      continue;
    }

    // Calculate tokens for this element
    const elementTokens = countTokens(element.text);

    // Check if adding this element would exceed max tokens
    if (currentTokenCount + elementTokens > maxTokens && currentChunk.length > 0) {
      // Create chunk from accumulated content
      chunks.push(createChunk(
        currentChunk,
        currentSection,
        currentSectionPath,
        chunkIndex++
      ));

      // Start new chunk with current element
      currentChunk = [element];
      currentTokenCount = elementTokens;
    } else {
      // Add element to current chunk
      currentChunk.push(element);
      currentTokenCount += elementTokens;
    }
  }

  // Flush remaining chunk
  if (currentChunk.length > 0 && currentTokenCount >= minTokens) {
    chunks.push(createChunk(
      currentChunk,
      currentSection,
      currentSectionPath,
      chunkIndex++
    ));
  }

  logger.info('Section-aware chunking complete', {
    inputElements: structure.length,
    outputChunks: chunks.length,
    avgChunkSize: Math.round(chunks.reduce((sum, c) => sum + c.tokenCount, 0) / chunks.length),
  });

  return chunks;
}

/**
 * Create a chunk object from accumulated elements
 */
function createChunk(elements, section, sectionPath, index) {
  // Combine text from all elements
  const text = elements.map(e => e.text).join('\n').trim();
  const tokenCount = countTokens(text);

  // Determine chunk type
  const types = elements.map(e => e.type);
  const isTableChunk = types.some(t => t === 'table_cell');
  const isListChunk = types.some(t => t === 'list_item');

  return {
    text,
    tokenCount,
    section,
    sectionPath,
    chunkIndex: index,
    elementTypes: types,
    isTableChunk,
    isListChunk,
  };
}

/**
 * Count tokens (approximate word count)
 */
function countTokens(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Chunk document by sections
 * Groups content under section headings
 */
export function chunkBySection(documentTree, options = {}) {
  const {
    maxTokens = 500,  // Larger for section-based chunking
    splitLargeSections = true,
  } = options;

  const chunks = [];
  let chunkIndex = 0;

  function processNode(node, parentPath = []) {
    const currentPath = [...parentPath, node.section];
    const sectionPath = currentPath.join(' > ');

    if (node.content.length > 0) {
      const sectionText = node.content.map(c => c.text).join('\n');
      const tokenCount = countTokens(sectionText);

      if (tokenCount <= maxTokens || !splitLargeSections) {
        // Create single chunk for entire section
        chunks.push({
          text: sectionText,
          tokenCount,
          section: node.section,
          sectionPath,
          chunkIndex: chunkIndex++,
          elementTypes: node.content.map(c => c.type),
        });
      } else {
        // Split large section into multiple chunks
        const subChunks = chunkStructuredDocument(node.content, {
          maxTokens: Math.floor(maxTokens * 0.8), // Slightly smaller for sub-chunks
          minTokens: 50,
          includeHeadings: false,
        });

        for (const subChunk of subChunks) {
          chunks.push({
            ...subChunk,
            section: node.section,
            sectionPath,
            chunkIndex: chunkIndex++,
          });
        }
      }
    }

    // Process child sections
    for (const child of node.children) {
      processNode(child, currentPath);
    }
  }

  processNode(documentTree, []);

  logger.info('Section-based chunking complete', {
    sections: countSections(documentTree),
    outputChunks: chunks.length,
  });

  return chunks;
}

/**
 * Count sections in document tree
 */
function countSections(tree) {
  let count = 0;
  
  function traverse(node) {
    if (node.content && node.content.length > 0) {
      count++;
    }
    for (const child of node.children || []) {
      traverse(child);
    }
  }

  traverse(tree);
  return count;
}

/**
 * Create hybrid chunks: both section-level and sub-section chunks
 * Provides multiple granularities for better retrieval
 */
export function createHybridChunks(structure, documentTree, options = {}) {
  const chunks = [];

  // Strategy 1: Fine-grained chunks (200-300 tokens)
  const fineChunks = chunkStructuredDocument(structure, {
    maxTokens: 300,
    minTokens: 50,
    includeHeadings: true,
  });

  // Strategy 2: Section-level chunks (entire sections)
  const sectionChunks = chunkBySection(documentTree, {
    maxTokens: 700,
    splitLargeSections: false,
  });

  // Mark chunk granularity
  fineChunks.forEach(chunk => {
    chunks.push({
      ...chunk,
      granularity: 'fine',
    });
  });

  sectionChunks.forEach(chunk => {
    chunks.push({
      ...chunk,
      granularity: 'section',
    });
  });

  logger.info('Hybrid chunking complete', {
    fineChunks: fineChunks.length,
    sectionChunks: sectionChunks.length,
    totalChunks: chunks.length,
  });

  return chunks;
}

export default {
  chunkStructuredDocument,
  chunkBySection,
  createHybridChunks,
};
